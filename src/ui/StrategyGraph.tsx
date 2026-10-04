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
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
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
import { relationCandidates, type Intent } from '../core/edits';
import type { GraphNotice } from '../core/graph-session';
import type { GsMap, GsPosition } from '../core/gsmap';
import { elkPositions, layoutKey, needsElk as needsElkFor, NODE_SIZES, pinnedPositions, placeNodes, structureOf } from '../core/layout';
import type { EditOutcome } from '../core/perform';
import type { Graph } from '../core/schema';
import { findSmells } from '../core/smells';
import { NodeActionsContext, type NodeActions } from './actions-context';
import type { RelationField } from '../core/writes';
import { Inspector } from './Inspector';
import { PopupMenu, QuickCreate, Toast, type MenuItem, type QuickCreateKind } from './GraphMenus';
import { followersOf, localToday, movedPositions, NODE_TYPE, toFlowEdges, toFlowNodes, unsavedPositions, type StrategyFlowNode } from './model';
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
  /** Perform an edit (Phase 6) and say how it went. Absent: the graph is read-only, and nothing offers an edit. */
  onEdit?: (intent: Intent) => Promise<EditOutcome>;
  /** A note's text, for the inspector. */
  readNote?: (path: string) => Promise<string>;
  /** Render a note into an element (Obsidian's reading view); returns the cleanup. */
  renderNote?: (el: HTMLElement, path: string) => () => void;
  /** The pointer enters a note's node: show the note's preview. */
  onHoverNote?: NodeActions['hover'];
  /** Today as `YYYY-MM-DD`, for the overdue smell. Defaults to the local date. */
  today?: string;
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
  onHoverNote,
  onEdit,
  readNote,
  renderNote,
  today,
  reveal,
  notices,
}: StrategyGraphProps & { placed: Record<string, GsPosition>; complete: boolean }) {
  const flow = useReactFlow<StrategyFlowNode>();
  const store = useStoreApi<StrategyFlowNode>();
  const editable = onMove !== null;
  const smells = useMemo(() => findSmells(graph, { today: today ?? localToday() }), [graph, today]);
  const [showUltimate, setShowUltimate] = useState(false);

  // ---- editing (Phase 6): every change is an intent for the host; the graph re-derives from the notes.
  const [outcome, setOutcome] = useState<(EditOutcome & { id: number }) | null>(null);
  const outcomeId = useRef(0);
  const perform = useMemo(() => {
    if (!onEdit) return null;
    return async (intent: Intent): Promise<EditOutcome> => {
      const result = await onEdit(intent).catch((error: unknown): EditOutcome => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
      setOutcome({ ...result, id: ++outcomeId.current });
      return result;
    };
  }, [onEdit]);
  const actions = useMemo<NodeActions>(
    () => ({
      hover: onHoverNote,
      canEdit: perform !== null,
      setStatus: (key, status) => void perform?.({ kind: 'set-status', key, status }),
      setDate: (key, value) => void perform?.({ kind: 'set-date', key, value }),
    }),
    [onHoverNote, perform]
  );
  const dismissOutcome = useCallback(() => setOutcome(null), []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** The note whose inspector was closed by hand: it stays closed until another note is selected. */
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const onSelectionChange = useCallback(({ nodes: picked }: { nodes: { id: string }[] }) => {
    const key = picked.length === 1 ? picked[0].id : null;
    setSelectedKey(key);
    setClosedKey((closed) => (closed === key ? closed : null));
  }, []);
  const inspected = selectedKey !== null && selectedKey !== closedKey ? graph.nodes.find((n) => n.key === selectedKey) ?? null : null;
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; label: string; items: MenuItem[] } | null>(null);
  const [create, setCreate] = useState<{ request: QuickCreateKind; anchor: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  /** A point in client coordinates as a place inside the graph's own box. */
  const placeOf = useCallback((client: { clientX: number; clientY: number }) => {
    const box = store.getState().domNode?.getBoundingClientRect();
    return { x: client.clientX - (box?.left ?? 0), y: client.clientY - (box?.top ?? 0) };
  }, [store]);
  const build = useCallback(
    () => toFlowNodes(graph, placed, smells).map((n) => (editable ? n : { ...n, draggable: false })),
    [graph, placed, editable, smells]
  );
  const [nodes, setNodes] = useState<StrategyFlowNode[]>(build);
  /** `nodes` as last rendered, for handlers React Flow calls synchronously. */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** Set while an arrow key is being handled: the position changes it causes are a move to save. */
  const arrowKey = useRef(false);
  // Edges follow the nodes as drawn, mid-drag included, so they always leave by the facing side.
  const drawn = useMemo(() => Object.fromEntries(nodes.filter((n) => !n.hidden).map((n) => [n.id, n.position])), [nodes]);
  // Edges are controlled too: a click selects a link (so Delete can remove it), which React Flow reports as a change to apply.
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdges((current) => {
      let next: Set<string> | null = null;
      for (const change of changes) {
        if (change.type !== 'select' || (next ?? current).has(change.id) === change.selected) continue;
        next ??= new Set(current);
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      }
      return next ?? current;
    });
  }, []);
  const edges = useMemo(
    () =>
      toFlowEdges(graph, drawn, { smells, showUltimate, editable: onEdit !== undefined }).map((edge) =>
        selectedEdges.has(edge.id) ? { ...edge, selected: true } : edge
      ),
    [graph, drawn, smells, showUltimate, onEdit, selectedEdges]
  );
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
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
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

  const removeRelation = useCallback(
    (edge: Edge) => {
      const found = graph.edges.find((e) => e.key === edge.id);
      if (found) void perform?.({ kind: 'remove-relation', holder: found.from, field: found.field as RelationField, target: found.to });
    },
    [graph, perform]
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, flowNode: StrategyFlowNode) => {
      event.preventDefault();
      const n = flowNode.data.node;
      const items: MenuItem[] = [];
      const ask = (request: QuickCreateKind) => () => setCreate({ request, anchor: n.key });
      if (perform) {
        const sequel = graph.edges.find((e) => e.kind === 'next' && e.from === n.key);
        const sequelNode = sequel && graph.nodes.find((g) => g.key === sequel.to);
        if (n.type === 'bet') {
          items.push({
            label: 'New sequel bet',
            disabled: sequel ? 'This bet already has a next sequel' : undefined,
            run: ask({ kind: 'bet', heading: 'New sequel bet', serves: [], sequelOf: n.key }),
          });
        }
        if (n.type === 'bet' || n.type === 'milestone' || n.type === 'fixed-point') {
          items.push({ label: 'New bet serving this', run: ask({ kind: 'bet', heading: 'New bet serving this', serves: [n.key] }) });
          items.push({ label: 'Add assumption', run: ask({ kind: 'assumption', heading: 'Add assumption', dependents: [n.key] }) });
        }
        if (n.type === 'bet') {
          const why = !sequelNode
            ? 'No next sequel to activate'
            : n.status === 'killed' || n.status === 'won'
              ? `This bet is already ${n.status}`
              : sequelNode.status !== 'dormant'
                ? `${sequelNode.id ?? sequelNode.basename} is not dormant`
                : undefined;
          items.push({ label: 'Kill → activate next', disabled: why, run: () => void perform({ kind: 'kill-activate-next', key: n.key }) });
        }
        if (n.type === 'assumption') {
          items.push({
            label: 'Mark falsified',
            disabled: n.status === 'falsified' ? 'Already falsified' : undefined,
            run: () => void perform({ kind: 'falsify', key: n.key }),
          });
        }
      }
      if (onOpenNote) {
        items.push({ label: 'Open note', run: () => onOpenNote(n.path, false) }, { label: 'Open in split', run: () => onOpenNote(n.path, true) });
      }
      if (items.length) setMenu({ at: placeOf(event), label: `Actions for ${n.id ?? n.basename}`, items });
    },
    [graph, perform, onOpenNote, placeOf]
  );

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.preventDefault();
      if (!perform) return;
      setMenu({ at: placeOf(event), label: 'Link', items: [{ label: 'Remove link', run: () => removeRelation(edge) }] });
    },
    [perform, placeOf, removeRelation]
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => deleted.forEach(removeRelation), [removeRelation]);

  // Dropping a link from a handle: the node under the pointer is the other end, handle or not.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = state.fromNode?.id;
      if (!perform || !from) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const doc = (event.target as Node | null)?.ownerDocument ?? document;
      const to = doc
        .elementsFromPoint(point.clientX, point.clientY)
        .map((el) => el.closest('.react-flow__node'))
        .find((el): el is Element => el !== null)
        ?.getAttribute('data-id');
      if (!to || to === from) return;
      const options = relationCandidates(graph, from, to);
      const open = options.filter((o) => !o.blocked);
      const say = (message: string) => setOutcome({ ok: false, message, id: ++outcomeId.current });
      const label = (key: string) => graph.nodes.find((n) => n.key === key)?.id ?? key;
      if (!options.length) return say(`${label(from)} and ${label(to)} can't be linked: no relation is defined between those types.`);
      if (!open.length) return say(options[0].blocked!);
      const apply = (o: (typeof open)[number]) => void perform({ kind: 'add-relation', holder: o.holder, field: o.field, target: o.target });
      if (open.length === 1) return apply(open[0]);
      setMenu({ at: placeOf(point), label: 'Which relation?', items: open.map((o) => ({ label: o.label, run: () => apply(o) })) });
    },
    [graph, perform, placeOf]
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
  const [fitWanted, setFitWanted] = useState(false);
  useEffect(() => {
    if (resetFrom.current === null || positions === resetFrom.current) return;
    if (hasSaved) {
      resetFrom.current = null;
      setFitWanted(false);
      return;
    }
    if (!complete) return;
    resetFrom.current = null;
    setFitWanted(true);
  }, [complete, positions, hasSaved]);
  // Fit only when every node is in and measured: asked earlier, React Flow fits whatever it has (nothing, or one node).
  useEffect(() => {
    if (!fitWanted) return;
    const shown = nodes.filter((n) => !n.hidden);
    if (!shown.length || shown.length < graph.nodes.length || shown.some((n) => !n.measured)) return;
    setFitWanted(false);
    void flow.fitView({ padding: 0.1, duration: 300 });
  }, [fitWanted, nodes, graph, flow]);

  return (
    <NodeActionsContext.Provider value={actions}>
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
        nodesConnectable={onEdit !== undefined}
        edgesFocusable={false}
        deleteKeyCode={onEdit ? ['Backspace', 'Delete'] : null}
        onConnectEnd={onConnectEnd}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={(event) => event.preventDefault()}
        onSelectionChange={onSelectionChange}
        zoomOnDoubleClick={false}
        // As on an Obsidian canvas: drag on empty space to select; a two-finger swipe (scroll),
        // Space+drag or middle-drag pans; a pinch or Cmd/Ctrl+scroll zooms. Dragging any selected node
        // moves the whole selection. The swipe moves the graph with the fingers, 1:1 (React Flow's
        // default is half speed).
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={PAN_BUTTONS}
        panOnScroll
        panOnScrollSpeed={1}
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
          <ControlButton
            className="gs-toggle-ultimate"
            onClick={() => setShowUltimate(!showUltimate)}
            title={showUltimate ? 'Hide ultimately-serves links' : 'Show ultimately-serves links'}
            aria-label="Show ultimately-serves links"
            aria-pressed={showUltimate}
          >
            <UltimateIcon />
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
        {inspected && (
          <Panel position="top-right" className="gs-inspector-panel">
            <Inspector
              graph={graph}
              node={inspected}
              perform={perform}
              readNote={readNote}
              renderNote={renderNote}
              onOpenNote={onOpenNote}
              onClose={() => setClosedKey(inspected.key)}
            />
          </Panel>
        )}
        {create && graph.nodes.find((n) => n.key === create.anchor) && perform && (
          <Panel position="bottom-center">
            <QuickCreate request={create.request} anchor={graph.nodes.find((n) => n.key === create.anchor)!} perform={perform} onClose={() => setCreate(null)} />
          </Panel>
        )}
        {menu && <PopupMenu at={menu.at} items={menu.items} label={menu.label} onClose={closeMenu} />}
        <Toast outcome={outcome} onDone={dismissOutcome} />
        {notices && notices.length > 0 && (
          <Panel position="top-left">
            <Notices notices={notices} onOpenNote={onOpenNote} />
          </Panel>
        )}
      </ReactFlow>
    </NodeActionsContext.Provider>
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

/** A long arrow reaching past a node: the far anchor `ultimately-serves` points at. */
function UltimateIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ fill: 'none' }} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4M10 12h3M16 12h5" strokeDasharray="1 0" />
      <path d="M17 8l4 4-4 4" />
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
