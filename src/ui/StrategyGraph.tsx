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
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { relationCandidates, type Intent } from '../core/edits';
import type { GraphNotice } from '../core/graph-session';
import type { GsCard, GsFrame, GsLink, GsMap, GsOp, GsPosition } from '../core/gsmap';
import { elkPositions, layoutKey, needsElk as needsElkFor, pinnedPositions, placeNodes, structureOf, type Size } from '../core/layout';
import type { EditOutcome } from '../core/perform';
import type { Graph } from '../core/schema';
import { findSmells } from '../core/smells';
import { NodeActionsContext, type NodeActions } from './actions-context';
import type { RelationField } from '../core/writes';
import { Inspector } from './Inspector';
import { ReviewWalk, SmellsPanel } from './ReviewPanels';
import { reviewWalk } from '../core/review-walk';
import { PopupMenu, QuickCreate, Toast, type MenuItem, type QuickCreateKind } from './GraphMenus';
import {
  CARD_DEFAULT_SIZE,
  CARD_TYPE,
  FRAME_DEFAULT_SIZE,
  FRAME_TYPE,
  dragCompanions,
  frameContents,
  holds,
  isCardNode,
  isFrameNode,
  isJunctionNode,
  isStrategyNode,
  JUNCTION_TYPE,
  junctionsOf,
  localToday,
  movedPositions,
  NODE_TYPE,
  requiresOf,
  toFlowCards,
  toFlowEdges,
  toFlowFrames,
  toFlowJunctions,
  toFlowLinks,
  toFlowNodes,
  unsavedPositions,
  type GraphFlowNode,
} from './model';
import { CardNode, FrameNode } from './FreeNodes';
import { ItemEditor, type EditedItem } from './ItemEditor';
import { JunctionNode, StrategyNode } from './StrategyNode';

export interface StrategyGraphProps {
  graph: Graph;
  /** Saved positions by note id (`positions` of the `.gsmap`). */
  positions: Readonly<Record<string, GsPosition>>;
  /** The `.gsmap`'s viewport, used once when the graph first shows. Without one, the graph is fitted to the view. */
  viewport?: GsMap['viewport'];
  /** Free cards, frames and links of the `.gsmap` (Phase 7); drawn with the notes. */
  cards?: readonly GsCard[];
  frames?: readonly GsFrame[];
  links?: readonly GsLink[];
  /** Change a card, frame or link; false when the `.gsmap` can't be written. Absent: they can't be edited. */
  onEditMap?: ((op: GsOp) => boolean) | null;
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
  /** "Add note card…": ask for a note, and call back with its path. Absent: the item is not offered. */
  pickNote?: (onPick: (path: string) => void) => void;
  /** The notes a drop on the graph carries, by path. Absent: dropping does nothing. */
  droppedNotes?: (event: DragEvent) => string[];
  /** The automatic layout of the time axis. ELK (`elkPositions`); the dev page swaps it to test a failure. */
  autoLayout?: (graph: Graph) => Promise<Record<string, GsPosition>>;
}

const nodeTypes = { [NODE_TYPE]: StrategyNode, [CARD_TYPE]: CardNode, [FRAME_TYPE]: FrameNode, [JUNCTION_TYPE]: JunctionNode };

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

/** Deleting more cards, frames and links than this in one go (counting what is selected) asks first. */
const BULK_DELETE = 3;

const NO_CARDS: readonly GsCard[] = [];
const NO_FRAMES: readonly GsFrame[] = [];
const NO_LINKS: readonly GsLink[] = [];

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
  onEditMap,
  cards = NO_CARDS,
  frames = NO_FRAMES,
  links = NO_LINKS,
  readNote,
  renderNote,
  pickNote,
  droppedNotes,
  today,
  reveal,
  notices,
}: StrategyGraphProps & { placed: Record<string, GsPosition>; complete: boolean }) {
  const flow = useReactFlow<GraphFlowNode>();
  const store = useStoreApi<GraphFlowNode>();
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
  // ---- free cards, frames and links (Phase 7): edits to the `.gsmap`, shown at once and written a moment later.
  const canEditMap = onEditMap != null;
  const mapOp = useCallback(
    (op: GsOp) => {
      if (onEditMap?.(op)) return true;
      setOutcome({ ok: false, message: "Strategy.gsmap can't be written, so this change was not saved.", id: ++outcomeId.current });
      return false;
    },
    [onEditMap]
  );
  const [editing, setEditing] = useState<{ kind: 'card' | 'frame'; id: string } | null>(null);
  const [editor, setEditor] = useState<{ kind: 'card' | 'frame' | 'link'; id: string } | null>(null);
  const freshId = useCallback(() => {
    const taken = new Set([...cards, ...frames, ...links].map((item) => item.id));
    for (;;) {
      const id = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
      if (!taken.has(id)) return id;
    }
  }, [cards, frames, links]);
  const actions = useMemo<NodeActions>(
    () => ({
      hover: onHoverNote,
      canEdit: perform !== null,
      setStatus: (key, status) => void perform?.({ kind: 'set-status', key, status }),
      setDate: (key, value) => void perform?.({ kind: 'set-date', key, value }),
      canEditMap,
      editing,
      startEdit: (kind, id) => canEditMap && setEditing({ kind, id }),
      commitText: (kind, id, text) => {
        setEditing(null);
        if (kind === 'card') {
          const card = cards.find((c) => c.id === id);
          if (!card) return;
          if (!text.trim() && card.kind === 'text') mapOp({ op: 'delete-card', id }); // an empty card is no card
          else if (card.kind === 'text' && text !== card.text) mapOp({ op: 'put-card', card: { ...card, text } });
        } else {
          const frame = frames.find((f) => f.id === id);
          if (frame && text.trim() !== frame.label) mapOp({ op: 'put-frame', frame: { ...frame, label: text.trim() } });
        }
      },
      cancelEdit: () => {
        // A card that was just made and never given text goes away again.
        const card = editing?.kind === 'card' ? cards.find((c) => c.id === editing.id) : undefined;
        setEditing(null);
        if (card && card.kind === 'text' && !card.text.trim()) mapOp({ op: 'delete-card', id: card.id });
      },
      resize: (kind, id, rect) => {
        const place = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        if (kind === 'card') {
          const card = cards.find((c) => c.id === id);
          if (card) mapOp({ op: 'put-card', card: { ...card, ...place } });
        } else {
          const frame = frames.find((f) => f.id === id);
          if (frame) mapOp({ op: 'put-frame', frame: { ...frame, ...place } });
        }
      },
      openNote: onOpenNote,
    }),
    [onHoverNote, perform, canEditMap, editing, cards, frames, mapOp, onOpenNote]
  );
  const dismissOutcome = useCallback(() => setOutcome(null), []);
  const [walkKey, setWalkKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** The note whose inspector was closed by hand: it stays closed until another note is selected. */
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const onSelectionChange = useCallback(({ nodes: picked }: { nodes: { id: string }[] }) => {
    const key = picked.length === 1 ? picked[0].id : null;
    setSelectedKey(key);
    setClosedKey((closed) => (closed === key ? closed : null));
  }, []);
  const inspected = walkKey === null && selectedKey !== null && selectedKey !== closedKey ? graph.nodes.find((n) => n.key === selectedKey) ?? null : null;
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; label: string; items: MenuItem[] } | null>(null);
  const [create, setCreate] = useState<{ request: QuickCreateKind; anchor: string | null } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // ---- review walk (Phase 8)
  const startWalk = useCallback(() => {
    const first = reviewWalk(graph)[0];
    if (!first) return setWalkKey('');
    setWalkKey(first.node);
    focusNodeRef.current(first.node);
  }, [graph]);
  const stepWalk = useCallback((key: string) => {
    setWalkKey(key);
    focusNodeRef.current(key);
  }, []);
  /** `focusNode` is defined further down, once the nodes exist; the walk calls it through here. */
  const focusNodeRef = useRef<(key: string) => boolean>(() => false);
  const editedItem: EditedItem | null = (() => {
    if (!editor) return null;
    if (editor.kind === 'card') return cards.find((c) => c.id === editor.id) ? { kind: 'card', item: cards.find((c) => c.id === editor.id)! } : null;
    if (editor.kind === 'frame') return frames.find((f) => f.id === editor.id) ? { kind: 'frame', item: frames.find((f) => f.id === editor.id)! } : null;
    return links.find((l) => l.id === editor.id) ? { kind: 'link', item: links.find((l) => l.id === editor.id)! } : null;
  })();
  /** A point in client coordinates as a place inside the graph's own box. */
  const placeOf = useCallback((client: { clientX: number; clientY: number }) => {
    const box = store.getState().domNode?.getBoundingClientRect();
    return { x: client.clientX - (box?.left ?? 0), y: client.clientY - (box?.top ?? 0) };
  }, [store]);
  const build = useCallback(
    (): GraphFlowNode[] => [
      ...toFlowFrames(frames, canEditMap),
      ...toFlowNodes(graph, placed, smells).map((n) => (editable ? n : { ...n, draggable: false })),
      ...toFlowCards(cards, canEditMap),
    ],
    [graph, placed, editable, smells, cards, frames, canEditMap]
  );
  const [nodes, setNodes] = useState<GraphFlowNode[]>(build);
  /** `nodes` as last rendered, for handlers React Flow calls synchronously. */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** Set while an arrow key is being handled: the position changes it causes are a move to save. */
  const arrowKey = useRef(false);
  // Edges follow the nodes as drawn, mid-drag included, so they always leave by the facing side.
  const drawn = useMemo(() => Object.fromEntries(nodes.filter((n) => isStrategyNode(n) && !n.hidden).map((n) => [n.id, n.position])), [nodes]);
  const rects = useMemo(
    () => new Map(nodes.filter((n) => !n.hidden && n.width && n.height).map((n) => [n.id, { ...n.position, width: n.width!, height: n.height! }] as const)),
    [nodes]
  );
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
  // "AND" junctions are drawn from the links and sit by their holder, wherever it is drawn: not part of `nodes`.
  const junctions = useMemo(() => junctionsOf(graph), [graph]);
  const shownNodes = useMemo(() => {
    const extra = toFlowJunctions(graph, junctions, drawn);
    return extra.length ? [...nodes, ...extra] : nodes;
  }, [graph, junctions, drawn, nodes]);
  const edges = useMemo(
    () =>
      [...toFlowEdges(graph, drawn, { smells, showUltimate, editable: onEdit !== undefined, junctions }), ...toFlowLinks(links, rects, canEditMap)].map((edge) =>
        selectedEdges.has(edge.id) ? { ...edge, selected: true } : edge
      ),
    [graph, drawn, smells, showUltimate, onEdit, selectedEdges, links, rects, canEditMap, junctions]
  );
  const satellites = useMemo(() => structureOf(graph).satellites, [graph]);
  const requires = useMemo(() => requiresOf(graph), [graph]);
  /** The shown notes as they were when the current drag began, and what the drag has moved along so far. */
  const dragging = useRef<{
    start: Map<string, GsPosition & Size>;
    movable: Set<string>;
    along: Map<string, GsPosition>;
    /** What the dragged frames carry: node id → the frame, and where both were at the start. */
    carried: Map<string, { frame: GsPosition; from: GsPosition; by: string }>;
  } | null>(null);
  /**
   * What moves along with `moved` (note key → where it is now): hosted assumptions, and prerequisites
   * pushed left (`dragCompanions`), measured from the notes as they were in `from`.
   */
  const companions = useCallback(
    (from: readonly GraphFlowNode[], moved: ReadonlyMap<string, GsPosition>) => {
      const start = new Map<string, GsPosition & Size>();
      const movable = new Set<string>();
      for (const n of from) {
        if (!isStrategyNode(n) || n.hidden) continue;
        start.set(n.id, { ...n.position, width: n.width ?? 0, height: n.height ?? 0 });
        if (n.draggable !== false) movable.add(n.id);
      }
      const notes = new Map(Array.from(moved).filter(([id]) => start.has(id)));
      return { start, movable, along: dragCompanions({ satellites, requires, start, movable, moved: notes }) };
    },
    [satellites, requires]
  );
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
    (moved: readonly Pick<GraphFlowNode, 'id' | 'position' | 'data' | 'type'>[]) => {
      // Free cards and frames carry their own place in the `.gsmap`.
      for (const node of moved) {
        const [x, y] = [Math.round(node.position.x), Math.round(node.position.y)];
        if (isCardNode(node) && (x !== node.data.card.x || y !== node.data.card.y)) mapOp({ op: 'put-card', card: { ...node.data.card, x, y } });
        else if (isFrameNode(node) && (x !== node.data.frame.x || y !== node.data.frame.y)) mapOp({ op: 'put-frame', frame: { ...node.data.frame, x, y } });
      }
      const updates = movedPositions(moved);
      if (!Object.keys(updates).length) return;
      onMove?.({ ...unsavedPositions(nodesRef.current, positions), ...updates });
    },
    [onMove, positions, mapOp]
  );

  // A selection box selects a frame only when it holds the whole frame, as on an Obsidian canvas: a box
  // drawn on empty space inside a frame is not a wish to select (and then move) the frame. React Flow's
  // own box picks every frame it touches, so while a box is drawn the frames follow this rule instead.
  const boxSelecting = useRef(false);
  /** The frames the selection box holds now (none when no box is drawn). */
  const framesInBox = useCallback((): Set<string> => {
    const { userSelectionRect: r, transform: [tx, ty, zoom] } = store.getState();
    if (!r) return new Set();
    const box = { x: (r.x - tx) / zoom, y: (r.y - ty) / zoom, width: r.width / zoom, height: r.height / zoom };
    return new Set(
      nodesRef.current.filter((n) => isFrameNode(n) && !n.hidden && n.width && n.height && holds(box, { ...n.position, width: n.width, height: n.height })).map((n) => n.id)
    );
  }, [store]);
  // The box grows over a frame without touching anything new, so React Flow reports no change: follow the box itself.
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (!boxSelecting.current || !state.userSelectionRect || state.userSelectionRect === previous.userSelectionRect) return;
        const held = framesInBox();
        setNodes((current) => {
          if (!current.some((n) => isFrameNode(n) && !!n.selected !== held.has(n.id))) return current;
          return current.map((n) => (isFrameNode(n) && !!n.selected !== held.has(n.id) ? { ...n, selected: held.has(n.id) } : n));
        });
      }),
    [store, framesInBox]
  );
  const onSelectionStart = useCallback(() => {
    boxSelecting.current = true;
  }, []);
  const onSelectionEnd = useCallback(() => {
    boxSelecting.current = false;
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<GraphFlowNode>[]) => {
      if (boxSelecting.current) {
        const isFrame = new Set(nodesRef.current.filter(isFrameNode).map((n) => n.id));
        const frames = new Set(changes.flatMap((c) => (c.type === 'select' && isFrame.has(c.id) ? [c.id] : [])));
        if (frames.size) {
          // React Flow has already marked them in its own copy: a new object for each makes it take ours.
          const held = framesInBox();
          const rest = changes.filter((c) => !(c.type === 'select' && frames.has(c.id)));
          setNodes((current) => applyNodeChanges(rest, current).map((n) => (frames.has(n.id) ? { ...n, selected: held.has(n.id) } : n)));
          return;
        }
      }
      const nudged = arrowKey.current ? changes.filter((c): c is NodePositionChange => c.type === 'position' && !!c.position) : [];
      if (!nudged.length) {
        setNodes((current) => applyNodeChanges(changes, current));
        return;
      }
      // Arrow keys move the selection without a drag: take the hosted assumptions along, push prerequisites, and save, as a drag does.
      const before = new Map(nodesRef.current.map((n) => [n.id, n]));
      const to = new Map(nudged.map((c) => [c.id, c.position!]));
      for (const [key, at] of companions(nodesRef.current, to).along) to.set(key, at);
      setNodes((current) => applyNodeChanges(changes, current).map((n) => (to.has(n.id) ? { ...n, position: to.get(n.id)! } : n)));
      save(Array.from(to).flatMap(([id, position]) => (before.has(id) ? [{ ...before.get(id)!, position }] : [])));
    },
    [companions, save]
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
        setConfirmingDelete((asking) => {
          asking?.answer(false);
          return null;
        });
        store.setState({ nodesSelectionActive: false });
        store.getState().resetSelectedElements();
        // React Flow blurs a focused node that Escape unselects: keep the keys coming to the graph.
        (event.currentTarget as HTMLElement).focus({ preventScroll: true });
      } else if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        // Not the frames: they are backdrops, and a selected frame is dragged and deleted with the rest.
        store.getState().addSelectedNodes(nodesRef.current.filter((n) => !n.hidden && !isFrameNode(n)).map((n) => n.id));
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
    (_event: unknown, _node: GraphFlowNode, dragged: GraphFlowNode[]) => {
      const { start, movable } = companions(nodesRef.current, new Map(dragged.map((n) => [n.id, n.position])));
      // A dragged frame carries what lies inside it (what can move: not fixed points, not what is dragged anyway).
      const rectOf = (n: GraphFlowNode) => ({ ...n.position, width: n.width ?? n.measured?.width ?? 0, height: n.height ?? n.measured?.height ?? 0 });
      const frames = new Map(dragged.filter(isFrameNode).map((n) => [n.id, rectOf(n)]));
      const draggedIds = new Set(dragged.map((n) => n.id));
      const items = new Map(
        nodesRef.current.filter((n) => !n.hidden && !draggedIds.has(n.id) && n.draggable !== false && !isJunctionNode(n)).map((n) => [n.id, rectOf(n)])
      );
      const carried = new Map<string, { frame: GsPosition; from: GsPosition; by: string }>();
      if (frames.size) {
        for (const [id, frame] of frameContents(frames, items)) carried.set(id, { frame: frames.get(frame)!, from: items.get(id)!, by: frame });
      }
      dragging.current = { start, movable, along: new Map(), carried };
    },
    [companions]
  );

  /** Where the drag has moved the other notes now: what moves along, and what no longer does back where it was. */
  const follow = useCallback(
    (dragged: GraphFlowNode[]) => {
      const drag = dragging.current;
      if (!drag) return new Map<string, GsPosition>();
      const now = new Map(dragged.map((n) => [n.id, n.position]));
      const carried = new Map<string, GsPosition>();
      for (const [id, { frame, from, by }] of drag.carried) {
        const at = now.get(by);
        if (at) carried.set(id, { x: from.x + at.x - frame.x, y: from.y + at.y - frame.y });
      }
      // Notes a frame carries count as dragged: their assumptions come along, their prerequisites get pushed.
      const moved = new Map([...now, ...carried].filter(([id]) => drag.start.has(id)));
      const along = new Map([...carried, ...dragCompanions({ satellites, requires, start: drag.start, movable: drag.movable, moved })]);
      const changed = new Map(along);
      for (const key of drag.along.keys()) {
        const was = drag.start.get(key);
        if (!along.has(key) && was) changed.set(key, { x: was.x, y: was.y });
      }
      drag.along = along;
      return changed;
    },
    [satellites, requires]
  );

  const onNodeDrag = useCallback(
    (_event: unknown, _node: GraphFlowNode, dragged: GraphFlowNode[]) => {
      const changed = follow(dragged);
      if (changed.size) setNodes((current) => current.map((n) => (changed.has(n.id) ? { ...n, position: changed.get(n.id)! } : n)));
    },
    [follow]
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: GraphFlowNode, dragged: GraphFlowNode[]) => {
      // Hosted assumptions and pushed prerequisites moved too: save them with the dragged notes.
      const changed = follow(dragged);
      const along = dragging.current?.along ?? new Map<string, GsPosition>();
      dragging.current = null;
      if (changed.size) setNodes((current) => current.map((n) => (changed.has(n.id) ? { ...n, position: changed.get(n.id)! } : n)));
      const others = nodesRef.current.filter((n) => along.has(n.id)).map((n) => ({ ...n, position: along.get(n.id)! }));
      save([...dragged, ...others]);
    },
    [follow, save]
  );

  const onNodeDoubleClick = useCallback(
    (event: ReactMouseEvent, node: GraphFlowNode) => {
      const newTab = event.metaKey || event.ctrlKey;
      if (isStrategyNode(node)) onOpenNote?.(node.data.node.path, newTab);
      else if (isCardNode(node)) {
        const card = node.data.card;
        if (card.kind === 'text') actions.startEdit('card', card.id);
        else if (card.kind === 'note-ref') onOpenNote?.(card.file, newTab);
        else if (/^https?:\/\//i.test(card.url)) window.open(card.url, '_blank', 'noopener');
      }
    },
    [onOpenNote, actions]
  );

  /** Remove a link: a relation is taken out of its note; a free link is taken out of the `.gsmap`. */
  const removeLink = useCallback(
    (edge: Edge) => {
      const link = (edge.data as { link?: GsLink } | undefined)?.link;
      if (link) return void mapOp({ op: 'delete-link', id: link.id });
      const found = graph.edges.find((e) => e.key === edge.id);
      if (found) void perform?.({ kind: 'remove-relation', holder: found.from, field: found.field as RelationField, target: found.to });
    },
    [graph, perform, mapOp]
  );

  // Delete after Cmd/Ctrl+A would erase every card and link at once, with no undo: more than a few at a time asks first.
  const [confirmingDelete, setConfirmingDelete] = useState<{ count: number; answer: (yes: boolean) => void } | null>(null);
  const onBeforeDelete = useCallback(
    ({ nodes: going, edges: leaving }: { nodes: GraphFlowNode[]; edges: Edge[] }) => {
      // What was picked: the links that go along with a card are not counted, or one card with a few lines would ask.
      const count = going.length + leaving.filter((edge) => edge.selected).length;
      if (count <= BULK_DELETE) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setConfirmingDelete({ count, answer: resolve }));
    },
    []
  );
  const answerDelete = (yes: boolean) => {
    confirmingDelete?.answer(yes);
    setConfirmingDelete(null);
  };

  const onNodesDelete = useCallback(
    (deleted: GraphFlowNode[]) => {
      for (const node of deleted) {
        if (isCardNode(node)) mapOp({ op: 'delete-card', id: node.data.card.id });
        else if (isFrameNode(node)) mapOp({ op: 'delete-frame', id: node.data.frame.id });
      }
    },
    [mapOp]
  );

  // ---- free cards and frames: menus, and making new ones.
  const newCard = useCallback(
    (at: { x: number; y: number }) => {
      const id = freshId();
      if (!mapOp({ op: 'put-card', card: { id, kind: 'text', text: '', x: Math.round(at.x), y: Math.round(at.y), ...CARD_DEFAULT_SIZE } })) return;
      setEditing({ kind: 'card', id });
    },
    [freshId, mapOp]
  );
  const newFrame = useCallback(
    (at: { x: number; y: number }) => {
      const id = freshId();
      if (!mapOp({ op: 'put-frame', frame: { id, label: '', x: Math.round(at.x), y: Math.round(at.y), ...FRAME_DEFAULT_SIZE } })) return;
      setEditing({ kind: 'frame', id });
    },
    [freshId, mapOp]
  );
  /**
   * Put notes on the graph as note cards (bug 2), stacked from `at`: any note of the vault, as on a
   * canvas. A strategy note is on the graph already: the view goes to it instead.
   */
  const addNoteCards = useCallback(
    (paths: readonly string[], at: { x: number; y: number }) => {
      const shown = paths.map((path) => graph.nodes.find((n) => n.path === path)).filter((n) => n !== undefined);
      let y = Math.round(at.y);
      for (const file of paths.filter((path) => !graph.nodes.some((n) => n.path === path))) {
        if (!mapOp({ op: 'put-card', card: { id: freshId(), kind: 'note-ref', file, x: Math.round(at.x), y, ...CARD_DEFAULT_SIZE } })) return;
        y += CARD_DEFAULT_SIZE.height + 20;
      }
      if (!shown.length) return;
      const names = shown.map((n) => n.id ?? n.basename);
      setOutcome({ ok: true, message: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} on the graph already.`, id: ++outcomeId.current });
      if (paths.length === 1) focusNodeRef.current(shown[0].key);
    },
    [graph, mapOp, freshId]
  );
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      if (!canEditMap) return;
      const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setMenu({
        at: placeOf(event),
        label: 'Graph',
        items: [
          { label: 'New card here', run: () => newCard(at) },
          ...(pickNote ? [{ label: 'Add note card…', run: () => pickNote((path) => addNoteCards([path], at)) }] : []),
          { label: 'New frame here', run: () => newFrame(at) },
        ],
      });
    },
    [canEditMap, flow, placeOf, newCard, newFrame, pickNote, addNoteCards]
  );
  // A note dragged in from the file explorer becomes a note card where it is dropped, as on a canvas.
  const takesDrops = canEditMap && droppedNotes !== undefined;
  const onDragOver = useCallback(
    (event: ReactDragEvent) => {
      if (!takesDrops) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    },
    [takesDrops]
  );
  const onDrop = useCallback(
    (event: ReactDragEvent) => {
      if (!takesDrops) return;
      event.preventDefault();
      event.stopPropagation();
      const paths = droppedNotes!(event.nativeEvent);
      if (paths.length) addNoteCards(paths, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [takesDrops, droppedNotes, addNoteCards, flow]
  );
  // A double-click on empty space makes a card there, as on a canvas.
  const onDoubleClickCapture = useCallback(
    (event: ReactMouseEvent) => {
      if (!canEditMap || !(event.target as HTMLElement).classList.contains('react-flow__pane')) return;
      newCard(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [canEditMap, flow, newCard]
  );
  const openCardMenu = useCallback(
    (event: ReactMouseEvent, card: GsCard) => {
      const items: MenuItem[] = [];
      if (canEditMap) {
        if (card.kind === 'text') items.push({ label: 'Edit text', run: () => setEditing({ kind: 'card', id: card.id }) });
        items.push({ label: 'Style…', run: () => setEditor({ kind: 'card', id: card.id }) });
        if (card.kind === 'text' && perform) {
          const first = card.text.trim().split(/\r?\n/)[0] ?? '';
          const ask = (request: QuickCreateKind) => () => setCreate({ request, anchor: null });
          items.push(
            { label: 'Promote to bet…', run: ask({ kind: 'bet', heading: 'Promote to bet', serves: [], initial: { title: first }, promote: card.id }) },
            { label: 'Promote to assumption…', run: ask({ kind: 'assumption', heading: 'Promote to assumption', dependents: [], initial: { statement: card.text.trim() }, promote: card.id }) },
            { label: 'Promote to milestone…', run: ask({ kind: 'milestone', heading: 'Promote to milestone', serves: [], initial: { title: first }, promote: card.id }) }
          );
        }
      }
      if (card.kind === 'note-ref' && onOpenNote) items.push({ label: 'Open note', run: () => onOpenNote(card.file, false) });
      if (canEditMap) items.push({ label: 'Delete card', run: () => void mapOp({ op: 'delete-card', id: card.id }) });
      if (items.length) setMenu({ at: placeOf(event), label: 'Card', items });
    },
    [canEditMap, perform, onOpenNote, mapOp, placeOf]
  );
  const openFrameMenu = useCallback(
    (event: ReactMouseEvent, frame: GsFrame) => {
      if (!canEditMap) return;
      setMenu({
        at: placeOf(event),
        label: 'Frame',
        items: [
          { label: 'Rename', run: () => setEditing({ kind: 'frame', id: frame.id }) },
          { label: 'Style…', run: () => setEditor({ kind: 'frame', id: frame.id }) },
          { label: 'Delete frame', run: () => void mapOp({ op: 'delete-frame', id: frame.id }) },
        ],
      });
    },
    [canEditMap, placeOf, mapOp]
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, flowNode: GraphFlowNode) => {
      event.preventDefault();
      if (isCardNode(flowNode)) return openCardMenu(event, flowNode.data.card);
      if (isFrameNode(flowNode)) return openFrameMenu(event, flowNode.data.frame);
      if (!isStrategyNode(flowNode)) return;
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
    [graph, perform, onOpenNote, placeOf, openCardMenu, openFrameMenu]
  );

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.preventDefault();
      const link = (edge.data as { link?: GsLink } | undefined)?.link;
      if (link) {
        if (!canEditMap) return;
        setMenu({
          at: placeOf(event),
          label: 'Link',
          items: [
            { label: 'Edit link…', run: () => setEditor({ kind: 'link', id: link.id }) },
            { label: 'Delete link', run: () => removeLink(edge) },
          ],
        });
      } else if (perform) {
        setMenu({ at: placeOf(event), label: 'Link', items: [{ label: 'Remove link', run: () => removeLink(edge) }] });
      }
    },
    [perform, canEditMap, placeOf, removeLink]
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => deleted.forEach(removeLink), [removeLink]);

  // Dropping a link from a handle: the node under the pointer is the other end, handle or not.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = state.fromNode?.id;
      if (!from || (!perform && !canEditMap)) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const doc = (event.target as Node | null)?.ownerDocument ?? document;
      const to = doc
        .elementsFromPoint(point.clientX, point.clientY)
        .map((el) => el.closest('.react-flow__node'))
        .find((el): el is Element => el !== null && !el.classList.contains('react-flow__node-frame'))
        ?.getAttribute('data-id');
      if (!to || to === from) return;
      // A card on either end: a free link, no strategy meaning.
      if (from.startsWith('card:') || to.startsWith('card:')) {
        if (!canEditMap) return;
        const endOf = (id: string): GsLink['from'] => (id.startsWith('card:') ? { card: id.slice('card:'.length) } : { note: id });
        const side = state.fromHandle?.id?.replace(/-source$/, '') as GsLink['fromSide'] | undefined;
        mapOp({ op: 'put-link', link: { id: freshId(), from: endOf(from), to: endOf(to), ...(side ? { fromSide: side } : {}) } });
        return;
      }
      if (!perform) return;
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
    [graph, perform, placeOf, canEditMap, mapOp, freshId]
  );

  const onInit = useCallback(
    (instance: ReactFlowInstance<GraphFlowNode>) => {
      // A pending reveal positions the view itself; otherwise the saved viewport (defaultViewport) or a fit.
      if (!reveal && !viewport) void instance.fitView({ padding: 0.1 });
      setReady(true);
    },
    [reveal, viewport]
  );

  /** Select a note and center the view on it (the smells panel, the review walk, "Reveal note in graph"). False when it isn't shown. */
  const focusNode = useCallback(
    (key: string) => {
      const target = nodesRef.current.find((n) => n.id === key && isStrategyNode(n) && !n.hidden);
      if (!target) return false;
      setNodes((current) => current.map((n) => (n.selected === (n.id === key) ? n : { ...n, selected: n.id === key })));
      const [w, h] = [target.width ?? 0, target.height ?? 0];
      void flow.setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
      return true;
    },
    [flow]
  );

  useEffect(() => {
    if (!ready || !reveal || revealed.current === reveal.nonce) return;
    if (!placed[reveal.key] || !graph.nodes.some((n) => n.key === reveal.key)) return;
    revealed.current = reveal.nonce;
    focusNode(reveal.key);
  }, [ready, reveal, graph, placed, focusNode]);

  focusNodeRef.current = focusNode;

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
    if (!shown.length || shown.filter(isStrategyNode).length < graph.nodes.length || shown.some((n) => !n.measured)) return;
    setFitWanted(false);
    void flow.fitView({ padding: 0.1, duration: 300 });
  }, [fitWanted, nodes, graph, flow]);

  return (
    <NodeActionsContext.Provider value={actions}>
      <ReactFlow<GraphFlowNode>
        nodes={shownNodes}
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
        nodesConnectable={onEdit !== undefined || canEditMap}
        edgesFocusable={false}
        deleteKeyCode={onEdit || canEditMap ? ['Backspace', 'Delete'] : null}
        onNodesDelete={onNodesDelete}
        onBeforeDelete={onBeforeDelete}
        onDoubleClickCapture={onDoubleClickCapture}
        onConnectEnd={onConnectEnd}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSelectionChange={onSelectionChange}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
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
        {confirmingDelete && (
          <Panel position="bottom-center">
            <div className="gs-confirm" role="dialog" aria-label="Delete">
              <span>Delete {confirmingDelete.count} selected cards, frames and links from the graph?</span>
              <button className="mod-warning" onClick={() => answerDelete(true)}>
                Delete
              </button>
              <button onClick={() => answerDelete(false)}>Cancel</button>
            </div>
          </Panel>
        )}
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
        {create && perform && (
          <Panel position="bottom-center">
            <QuickCreate
              request={create.request}
              anchor={create.anchor === null ? undefined : graph.nodes.find((n) => n.key === create.anchor)}
              perform={perform}
              // A promoted card becomes the note it made: its links and its place go to the note.
              onCreated={(outcome) => {
                const card = create.request.promote;
                if (card && outcome.created) mapOp({ op: 'promote-card', card, note: outcome.created.id });
              }}
              onClose={() => setCreate(null)}
            />
          </Panel>
        )}
        {editor && editedItem && (
          <Panel position="bottom-center">
            <ItemEditor edited={editedItem} onOp={mapOp} onClose={() => setEditor(null)} />
          </Panel>
        )}
        {menu && <PopupMenu at={menu.at} items={menu.items} label={menu.label} onClose={closeMenu} />}
        <Toast outcome={outcome} onDone={dismissOutcome} />
        <Panel position="top-left" className="gs-toolbar">
          {notices && notices.length > 0 && <Notices notices={notices} onOpenNote={onOpenNote} />}
          <SmellsPanel graph={graph} smells={smells} onFocus={focusNode} />
          <button className="gs-toolbar-button" onClick={() => (walkKey === null ? startWalk() : setWalkKey(null))} aria-pressed={walkKey !== null}>
            Review walk
          </button>
        </Panel>
        {walkKey !== null && (
          <Panel position="bottom-center">
            <ReviewWalk graph={graph} smells={smells} current={walkKey} onStep={stepWalk} onClose={() => setWalkKey(null)} />
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
