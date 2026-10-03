import {
  applyNodeChanges,
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { GraphNotice } from '../core/graph-session';
import type { GsMap, GsPosition } from '../core/gsmap';
import { elkPositions, layoutKey, NODE_SIZES, pinnedPositions, placeNodes } from '../core/layout';
import type { Graph } from '../core/schema';
import { movedPositions, NODE_TYPE, toFlowEdges, toFlowNodes, type StrategyFlowNode } from './model';
import { StrategyNode } from './StrategyNode';

export interface StrategyGraphProps {
  graph: Graph;
  /** Saved positions by note id (`positions` of the `.gsmap`). */
  positions: Readonly<Record<string, GsPosition>>;
  /** The `.gsmap`'s viewport, used once when the graph first shows. Without one, the graph is fitted to the view. */
  viewport?: GsMap['viewport'];
  /** Called on drag end with the moved nodes' positions by note id. Null when nothing can be saved: dragging is off. */
  onMove: ((updates: Record<string, GsPosition>) => void) | null;
  /** Double-click on a node. `newTab` when Ctrl/Cmd was held. */
  onOpenNote?: (path: string, newTab: boolean) => void;
  /** Center on and select this node; a new `nonce` repeats the request. */
  reveal?: { key: string; nonce: number } | null;
  /** Problems to list on the graph (graph issues, changed ids, an unreadable `.gsmap`). */
  notices?: readonly GraphNotice[];
}

const nodeTypes = { [NODE_TYPE]: StrategyNode };

/**
 * Final positions for every node: saved ones as they are, the rest from ELK. ELK runs only when
 * the nodes or visible edges change and something is unsaved; a drag only re-places. While ELK
 * runs, nodes it has not placed yet are left out (hidden), never drawn at a guessed spot.
 */
function useLayout(graph: Graph, saved: Readonly<Record<string, GsPosition>>) {
  const key = useMemo(() => layoutKey(graph), [graph]);
  const pinned = useMemo(() => pinnedPositions(graph, saved), [graph, saved]);
  const needsElk = graph.nodes.some((n) => !pinned[n.key]);
  const [layered, setLayered] = useState<{ key: string; positions: Record<string, GsPosition> } | null>(null);
  const current = layered?.key === key;

  useEffect(() => {
    if (!needsElk || current) return;
    let cancelled = false;
    elkPositions(graph).then(
      (positions) => {
        if (!cancelled) setLayered({ key, positions });
      },
      (error) => console.error('strategy graph: layout failed', error)
    );
    return () => {
      cancelled = true;
    };
    // `key` stands for `graph` here: a new graph object with the same nodes and edges needs no new layout.
  }, [key, needsElk, current]);

  return useMemo(() => {
    if (!needsElk) return { positions: placeNodes(graph, {}, pinned), complete: true };
    if (!layered) return { positions: pinned, complete: false };
    const known = (k: string) => Boolean(pinned[k] || layered.positions[k]);
    const placed = placeNodes(graph, layered.positions, pinned);
    const positions = Object.fromEntries(Object.entries(placed).filter(([k]) => known(k)));
    return { positions, complete: current };
  }, [graph, pinned, needsElk, layered, current]);
}

export function StrategyGraph(props: StrategyGraphProps) {
  const layout = useLayout(props.graph, props.positions);
  // Mount React Flow once the first layout is complete, so its first frame is the real one.
  const [started, setStarted] = useState(layout.complete);
  useEffect(() => {
    if (layout.complete) setStarted(true);
  }, [layout.complete]);
  return (
    <div className="gs-graph">
      {started ? (
        <ReactFlowProvider>
          <Flow {...props} placed={layout.positions} />
        </ReactFlowProvider>
      ) : (
        <div className="gs-graph-loading">Laying out the graph…</div>
      )}
    </div>
  );
}

function Flow({ graph, placed, viewport, onMove, onOpenNote, reveal, notices }: StrategyGraphProps & { placed: Record<string, GsPosition> }) {
  const flow = useReactFlow<StrategyFlowNode>();
  const editable = onMove !== null;
  const build = useCallback(
    () => toFlowNodes(graph, placed).map((n) => (editable ? n : { ...n, draggable: false })),
    [graph, placed, editable]
  );
  const [nodes, setNodes] = useState<StrategyFlowNode[]>(build);
  const edges = useMemo(() => toFlowEdges(graph), [graph]);
  const [ready, setReady] = useState(false);
  const revealed = useRef<number | null>(null);

  // New data or positions: rebuild the nodes, keeping selection, and keeping a node that is mid-drag where the pointer has it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setNodes((previous) => {
      const before = new Map(previous.map((n) => [n.id, n]));
      return build().map((n) => {
        const old = before.get(n.id);
        if (!old) return n;
        const kept = { ...n, selected: old.selected };
        return old.dragging ? { ...kept, position: old.position, dragging: true } : kept;
      });
    });
  }, [build]);

  const onNodesChange = useCallback((changes: NodeChange<StrategyFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: StrategyFlowNode, dragged: StrategyFlowNode[]) => {
      const updates = movedPositions(dragged);
      if (onMove && Object.keys(updates).length) onMove(updates);
    },
    [onMove]
  );

  const onNodeDoubleClick = useCallback(
    (event: ReactMouseEvent, node: StrategyFlowNode) => onOpenNote?.(node.data.node.path, event.metaKey || event.ctrlKey),
    [onOpenNote]
  );

  const onInit = useCallback(
    (instance: ReactFlowInstance<StrategyFlowNode>) => {
      // A pending reveal positions the view itself; otherwise the saved viewport (defaultViewport) or a fit.
      if (!reveal && !viewport) void instance.fitView({ padding: 0.1 });
      setReady(true);
    },
    [reveal, viewport]
  );

  useEffect(() => {
    if (!ready || !reveal || revealed.current === reveal.nonce) return;
    const node = graph.nodes.find((n) => n.key === reveal.key);
    const at = placed[reveal.key];
    if (!node || !at) return;
    revealed.current = reveal.nonce;
    setNodes((current) => current.map((n) => (n.selected === (n.id === reveal.key) ? n : { ...n, selected: n.id === reveal.key })));
    const size = NODE_SIZES[node.type];
    void flow.setCenter(at.x + size.width / 2, at.y + size.height / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
  }, [ready, reveal, graph, placed, flow]);

  return (
    <ReactFlow<StrategyFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeDoubleClick={onNodeDoubleClick}
      onInit={onInit}
      defaultViewport={viewport ?? { x: 0, y: 0, zoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      zoomOnDoubleClick={false}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      {notices && notices.length > 0 && (
        <Panel position="top-left">
          <Notices notices={notices} onOpenNote={onOpenNote} />
        </Panel>
      )}
    </ReactFlow>
  );
}

function Notices({ notices, onOpenNote }: { notices: readonly GraphNotice[]; onOpenNote?: StrategyGraphProps['onOpenNote'] }) {
  const [open, setOpen] = useState(false);
  const errors = notices.filter((n) => n.severity === 'error').length;
  const label = `${notices.length} ${notices.length === 1 ? 'issue' : 'issues'}`;
  return (
    <div className={`gs-notices${errors ? ' has-errors' : ''}`}>
      <button className="gs-notices-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <ul className="gs-notices-list">
          {notices.map((notice, i) => (
            <li key={i} className={`gs-notice gs-notice--${notice.severity}`}>
              {notice.path && onOpenNote ? (
                <a onClick={() => onOpenNote(notice.path!, false)}>{notice.message}</a>
              ) : (
                notice.message
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
