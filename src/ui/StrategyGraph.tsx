import {
  applyNodeChanges,
  Background,
  ControlButton,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStoreApi,
  type NodeChange,
  type NodePositionChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { GraphNotice } from '../core/graph-session';
import type { GsMap, GsPosition } from '../core/gsmap';
import { elkPositions, layoutKey, needsElk as needsElkFor, NODE_SIZES, pinnedPositions, placeNodes, structureOf } from '../core/layout';
import type { Graph } from '../core/schema';
import { followersOf, movedPositions, NODE_TYPE, toFlowEdges, toFlowNodes, unsavedPositions, type StrategyFlowNode } from './model';
import { StrategyNode } from './StrategyNode';

export interface StrategyGraphProps {
  graph: Graph;
  /** Saved positions by note id (`positions` of the `.gsmap`). */
  positions: Readonly<Record<string, GsPosition>>;
  /** The `.gsmap`'s viewport, used once when the graph first shows. Without one, the graph is fitted to the view. */
  viewport?: GsMap['viewport'];
  /** Called on drag end with the moved nodes' positions by note id. Null when nothing can be saved: dragging is off. */
  onMove: ((updates: Record<string, GsPosition>) => void) | null;
  /** The reset button: forget every saved position. Null when nothing can be saved: the button is off. */
  onResetPositions?: (() => void) | null;
  /** Double-click on a node. `newTab` when Ctrl/Cmd was held. */
  onOpenNote?: (path: string, newTab: boolean) => void;
  /** Center on and select this node; a new `nonce` repeats the request. */
  reveal?: { key: string; nonce: number } | null;
  /** Problems to list on the graph (graph issues, changed ids, an unreadable `.gsmap`). */
  notices?: readonly GraphNotice[];
  /** The automatic layout of the time axis. ELK (`elkPositions`); the dev page swaps it to test a failure. */
  autoLayout?: (graph: Graph) => Promise<Record<string, GsPosition>>;
}

const nodeTypes = { [NODE_TYPE]: StrategyNode };

/** Keys React Flow moves the selected nodes with (5 px, 20 with Shift). */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Pan with the middle button (and any button while Space is held, React Flow's pan key). */
const PAN_BUTTONS = [1];
/** Shift-click adds to the selection or takes a node out of it, as on a canvas; so do Cmd/Ctrl-click. */
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control'];

/**
 * Final positions for every node: saved ones as they are, the rest from ELK. ELK runs only when
 * the nodes or visible edges change and something is unsaved; a drag only re-places. While ELK
 * runs, nodes it has not placed yet are left out (hidden), never drawn at a guessed spot.
 */
function useLayout(graph: Graph, saved: Readonly<Record<string, GsPosition>>, autoLayout = elkPositions) {
  const key = useMemo(() => layoutKey(graph), [graph]);
  const pinned = useMemo(() => pinnedPositions(graph, saved), [graph, saved]);
  const needsElk = useMemo(() => needsElkFor(graph, pinned), [graph, pinned]);
  const [layered, setLayered] = useState<{ key: string; positions: Record<string, GsPosition> } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const current = layered?.key === key;
  const error = failed?.key === key && !current ? failed.message : null;

  useEffect(() => {
    if (!needsElk || current || error !== null) return;
    let cancelled = false;
    autoLayout(graph).then(
      (positions) => {
        if (!cancelled) setLayered({ key, positions });
      },
      (reason: unknown) => {
        console.error('strategy graph: layout failed', reason);
        if (!cancelled) setFailed({ key, message: reason instanceof Error ? reason.message : String(reason) });
      }
    );
    return () => {
      cancelled = true;
    };
    // `key` stands for `graph` here: a new graph object with the same nodes and edges needs no new layout.
  }, [key, needsElk, current, error]);

  // placeNodes leaves out what it can't place yet (no saved position, ELK not done or failed).
  // A failed layout is complete too: the graph shows what it can, and says what it left out.
  return useMemo(() => {
    if (!needsElk) return { positions: placeNodes(graph, {}, pinned), complete: true, error: null };
    const positions = placeNodes(graph, current ? layered!.positions : {}, pinned);
    return { positions, complete: current || error !== null, error };
  }, [graph, pinned, needsElk, layered, current, error]);
}

export function StrategyGraph(props: StrategyGraphProps) {
  const layout = useLayout(props.graph, props.positions, props.autoLayout);
  const unplaced = props.graph.nodes.length - Object.keys(layout.positions).length;
  const notices: readonly GraphNotice[] = layout.error
    ? [
        {
          severity: 'error',
          message: `The automatic layout failed (${layout.error}), so ${unplaced} ${unplaced === 1 ? 'note' : 'notes'} without a saved position ${unplaced === 1 ? 'is' : 'are'} not shown.`,
        },
        ...(props.notices ?? []),
      ]
    : props.notices ?? [];
  // Mount React Flow once the first layout is complete, so its first frame is the real one.
  const [started, setStarted] = useState(layout.complete);
  useEffect(() => {
    if (layout.complete) setStarted(true);
  }, [layout.complete]);
  return (
    <div className="gs-graph">
      {started ? (
        <ReactFlowProvider>
          <Flow {...props} notices={notices} placed={layout.positions} complete={layout.complete} />
        </ReactFlowProvider>
      ) : (
        <div className="gs-graph-loading">Laying out the graph…</div>
      )}
    </div>
  );
}

function Flow({
  graph,
  positions,
  placed,
  complete,
  viewport,
  onMove,
  onResetPositions,
  onOpenNote,
  reveal,
  notices,
}: StrategyGraphProps & { placed: Record<string, GsPosition>; complete: boolean }) {
  const flow = useReactFlow<StrategyFlowNode>();
  const store = useStoreApi<StrategyFlowNode>();
  const editable = onMove !== null;
  const build = useCallback(
    () => toFlowNodes(graph, placed).map((n) => (editable ? n : { ...n, draggable: false })),
    [graph, placed, editable]
  );
  const [nodes, setNodes] = useState<StrategyFlowNode[]>(build);
  /** `nodes` as last rendered, for handlers React Flow calls synchronously. */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** Set while an arrow key is being handled: the position changes it causes are a move to save. */
  const arrowKey = useRef(false);
  // Edges follow the nodes as drawn, mid-drag included, so they always leave by the facing side.
  const drawn = useMemo(() => Object.fromEntries(nodes.filter((n) => !n.hidden).map((n) => [n.id, n.position])), [nodes]);
  const edges = useMemo(() => toFlowEdges(graph, drawn), [graph, drawn]);
  const satellites = useMemo(() => structureOf(graph).satellites, [graph]);
  /** Assumptions moving with the current drag: where each started, and its host's start (D19). */
  const following = useRef<Map<string, { start: { x: number; y: number }; host: string; hostStart: { x: number; y: number } }>>(new Map());
  const [ready, setReady] = useState(false);
  const revealed = useRef<number | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  /** While a reset waits for its new layout, to fit the view to it: the saved positions it was asked on. */
  const resetFrom = useRef<StrategyGraphProps['positions'] | null>(null);
  const hasSaved = Object.keys(positions).length > 0;

  // New data or positions: rebuild the nodes, keeping selection, and keeping a node that is mid-drag where the pointer has it.
  // `measured` is React Flow's: a node without it loses its measured handles, and its edges are not
  // drawn until it is measured again, so a rebuild after every save would blank out every edge.
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
        const kept = { ...n, selected: old.selected, ...(old.measured && !old.hidden ? { measured: old.measured } : {}) };
        return old.dragging ? { ...kept, position: old.position, dragging: true } : kept;
      });
    });
  }, [build]);

  /** Save moved nodes, and pin everything else where it is, so nothing that wasn't moved moves (unsaved nodes are placed around saved ones). */
  const save = useCallback(
    (moved: readonly Pick<StrategyFlowNode, 'id' | 'position' | 'data'>[]) => {
      const updates = movedPositions(moved);
      if (!Object.keys(updates).length) return;
      onMove?.({ ...unsavedPositions(nodesRef.current, positions), ...updates });
    },
    [onMove, positions]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<StrategyFlowNode>[]) => {
      const nudged = arrowKey.current ? changes.filter((c): c is NodePositionChange => c.type === 'position' && !!c.position) : [];
      if (!nudged.length) {
        setNodes((current) => applyNodeChanges(changes, current));
        return;
      }
      // Arrow keys move the selection without a drag: take the hosted assumptions along and save, as a drag does.
      const before = new Map(nodesRef.current.map((n) => [n.id, n]));
      const to = new Map(nudged.map((c) => [c.id, c.position!]));
      for (const [key, host] of followersOf(satellites, Array.from(to.keys()))) {
        const [node, from, at] = [before.get(key), before.get(host), to.get(host)];
        if (node && from && at && !node.hidden) to.set(key, { x: node.position.x + at.x - from.position.x, y: node.position.y + at.y - from.position.y });
      }
      setNodes((current) => applyNodeChanges(changes, current).map((n) => (to.has(n.id) ? { ...n, position: to.get(n.id)! } : n)));
      save(Array.from(to).flatMap(([id, position]) => (before.has(id) ? [{ ...before.get(id)!, position }] : [])));
    },
    [satellites, save]
  );

  const onKeyDownCapture = useCallback((event: ReactKeyboardEvent) => {
    if (!ARROW_KEYS.has(event.key)) return;
    // React Flow moves the nodes while this keydown is dispatched. React runs capture and bubble
    // handlers from separate native listeners, with microtasks in between, so clear after a task.
    arrowKey.current = true;
    setTimeout(() => (arrowKey.current = false));
  }, []);

  // Canvas keys: Cmd/Ctrl+A selects every node, Escape clears the selection.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        setConfirmingReset(false);
        store.setState({ nodesSelectionActive: false });
        store.getState().resetSelectedElements();
        // React Flow blurs a focused node that Escape unselects: keep the keys coming to the graph.
        (event.currentTarget as HTMLElement).focus({ preventScroll: true });
      } else if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        store.getState().addSelectedNodes(nodesRef.current.filter((n) => !n.hidden).map((n) => n.id));
      }
    },
    [store]
  );

  // Clicking the empty pane doesn't move focus by itself: take it, so the keys above reach the graph.
  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (!el.contains(el.ownerDocument.activeElement)) el.focus({ preventScroll: true });
  }, []);

  const onNodeDragStart = useCallback(
    (_event: unknown, _node: StrategyFlowNode, dragged: StrategyFlowNode[]) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const hosts = new Map(dragged.map((n) => [n.id, n.position]));
      following.current = new Map();
      for (const [key, host] of followersOf(satellites, dragged.map((n) => n.id))) {
        const node = byId.get(key);
        if (node && !node.hidden) following.current.set(key, { start: node.position, host, hostStart: hosts.get(host)! });
      }
    },
    [nodes, satellites]
  );

  const onNodeDrag = useCallback((_event: unknown, _node: StrategyFlowNode, dragged: StrategyFlowNode[]) => {
    if (!following.current.size) return;
    const now = new Map(dragged.map((n) => [n.id, n.position]));
    setNodes((current) =>
      current.map((n) => {
        const f = following.current.get(n.id);
        const host = f && now.get(f.host);
        if (!f || !host) return n;
        return { ...n, position: { x: f.start.x + host.x - f.hostStart.x, y: f.start.y + host.y - f.hostStart.y } };
      })
    );
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: StrategyFlowNode, dragged: StrategyFlowNode[]) => {
      // The hosted assumptions moved too: save them with their host.
      const now = new Map(dragged.map((n) => [n.id, n.position]));
      const followers = nodes
        .filter((n) => following.current.has(n.id))
        .map((n) => {
          const f = following.current.get(n.id)!;
          const host = now.get(f.host)!;
          return { ...n, position: { x: f.start.x + host.x - f.hostStart.x, y: f.start.y + host.y - f.hostStart.y } };
        });
      following.current = new Map();
      save([...dragged, ...followers]);
    },
    [save, nodes]
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

  const resetPositions = useCallback(() => {
    setConfirmingReset(false);
    if (!onResetPositions) return;
    resetFrom.current = positions;
    onResetPositions();
  }, [onResetPositions, positions]);

  // After a reset, show the whole new layout once it is complete. Positions that come back (the reset
  // couldn't be saved) or a drag before the layout is done cancel the fit.
  useEffect(() => {
    if (resetFrom.current === null || positions === resetFrom.current) return;
    if (hasSaved) {
      resetFrom.current = null;
      return;
    }
    if (!complete) return;
    resetFrom.current = null;
    // React Flow fits once the nodes it is given next are in: the rebuilt ones, at their new places.
    void flow.fitView({ padding: 0.1, duration: 300 });
  }, [complete, positions, hasSaved, flow]);

  return (
    <ReactFlow<StrategyFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
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
      // As on an Obsidian canvas: drag on empty space to select, Space+drag, middle-drag or scroll to
      // pan, Cmd/Ctrl+scroll or pinch to zoom. Dragging any selected node moves the whole selection.
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      panOnDrag={PAN_BUTTONS}
      panOnScroll
      multiSelectionKeyCode={MULTI_SELECT_KEYS}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyDownCapture={onKeyDownCapture}
      onPointerDownCapture={onPointerDownCapture}
    >
      <Background gap={20} />
      <Controls showInteractive={false}>
        <ControlButton
          className="gs-reset-layout"
          onClick={() => setConfirmingReset(!confirmingReset)}
          disabled={!onResetPositions || !hasSaved}
          title="Reset layout: forget every saved position"
          aria-label="Reset layout"
        >
          <ResetIcon />
        </ControlButton>
      </Controls>
      {confirmingReset && (
        <Panel position="bottom-center">
          <div className="gs-confirm" role="dialog" aria-label="Reset layout">
            <span>Forget every saved position and lay the whole graph out automatically?</span>
            <button className="mod-warning" onClick={resetPositions}>
              Reset
            </button>
            <button onClick={() => setConfirmingReset(false)}>Cancel</button>
          </div>
        </Panel>
      )}
      {notices && notices.length > 0 && (
        <Panel position="top-left">
          <Notices notices={notices} onOpenNote={onOpenNote} />
        </Panel>
      )}
    </ReactFlow>
  );
}

/** A circular arrow (Lucide's rotate-ccw), drawn with strokes: React Flow's control CSS fills icons, so fill is off here. */
function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ fill: 'none' }} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
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
                <button className="gs-notice-link" onClick={() => onOpenNote(notice.path!, false)}>
                  {notice.message}
                </button>
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
