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
  type RefObject,
} from 'react';
import { relationCandidates, type Intent } from '../core/edits';
import type { GraphNotice } from '../core/graph-session';
import type { GsCard, GsFrame, GsLink, GsMap, GsOp, GsPosition } from '../core/gsmap';
import { elkPositions, layoutKey, needsElk as needsElkFor, pinnedPositions, placeNodes, structureOf, type Size } from '../core/layout';
import type { EditOutcome } from '../core/perform';
import { statusesFor, type Graph } from '../core/schema';
import { findSmells } from '../core/smells';
import { NodeActionsContext, type NodeActions } from './actions-context';
import type { RelationField } from '../core/writes';
import { Inspector } from './Inspector';
import { ReviewWalk, SmellsList, SmellsPanel } from './ReviewPanels';
import { ActionSheet, DockCard, FreeItemDetails, Icon, PeekCard, PhoneToolbar, Sheet, useTouchGestures, usePhoneFrame, type PhoneFrame } from './Phone';
import { reviewWalk, type WalkStep } from '../core/review-walk';
import { PopupMenu, QuickCreate, Toast, type MenuItem, type QuickCreateKind } from './GraphMenus';
import {
  CARD_DEFAULT_SIZE,
  CARD_TYPE,
  cardNodeId,
  FRAME_DEFAULT_SIZE,
  FRAME_TYPE,
  dragCompanions,
  frameAround,
  frameContents,
  frameNodeId,
  holds,
  isCardNode,
  isFixedPointNode,
  isFrameNode,
  isJunctionNode,
  isStrategyNode,
  JUNCTION_TYPE,
  junctionsOf,
  keepColumn,
  localToday,
  movedPositions,
  NODE_TYPE,
  panIntoFree,
  peekOf,
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
  /**
   * The phone layout (plan Phase 8b, D22): taps, sheets and docked cards instead of hover, menus and
   * panels; one finger pans, and nodes drag only with Edit layout on. Off: the desktop layout.
   */
  phone?: boolean;
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
  const box = useRef<HTMLDivElement>(null);
  const frame = usePhoneFrame(box, props.phone === true);
  return (
    <div className={`gs-graph${props.phone ? ' gs-graph--phone' : ''}`} ref={box}>
      {started ? (
        <ReactFlowProvider>
          <Flow {...props} notices={notices} placed={layout.positions} complete={layout.complete} box={box} frame={frame} />
        </ReactFlowProvider>
      ) : (
        <div className="gs-graph-loading">Laying out the graph…</div>
      )}
    </div>
  );
}

/** Deleting more cards, frames and links than this in one go (counting what is selected) asks first. */
const BULK_DELETE = 3;

/** The phone's modal sheets (D22). Details are by React Flow id: a note, a free card or a frame. */
type PhoneSheet =
  | { kind: 'details'; id: string }
  | { kind: 'smells' }
  | { kind: 'issues' }
  | { kind: 'actions'; title: string; items: MenuItem[] }
  | { kind: 'confirm'; question: string; label: string; run: () => void };

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
  phone = false,
  box,
  frame,
}: StrategyGraphProps & { placed: Record<string, GsPosition>; complete: boolean; box: RefObject<HTMLDivElement | null>; frame: PhoneFrame }) {
  const flow = useReactFlow<GraphFlowNode>();
  const store = useStoreApi<GraphFlowNode>();
  const editable = onMove !== null;
  const smells = useMemo(() => findSmells(graph, { today: today ?? localToday() }), [graph, today]);
  const [showUltimate, setShowUltimate] = useState(false);
  /** Phone only: nodes, cards and frames drag only while this is on (O5: it starts off every time). */
  const [editLayout, setEditLayout] = useState(false);
  /** Phone only: the modal sheet that is open (one at a time). */
  const [sheet, setSheet] = useState<PhoneSheet | null>(null);

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
      // A phone has no hover, and edits go through the sheets, not controls on the nodes.
      hover: phone ? undefined : onHoverNote,
      canEdit: perform !== null && !phone,
      setStatus: (key, status) => void perform?.({ kind: 'set-status', key, status }),
      setDate: (key, value) => void perform?.({ kind: 'set-date', key, value }),
      // On a phone, cards and frames resize only with Edit layout on, and are edited in the details sheet (O4).
      canEditMap: canEditMap && (!phone || editLayout),
      editing,
      startEdit: (kind, id) => {
        if (!canEditMap) return;
        if (phone) openDetailsRef.current(kind === 'card' ? cardNodeId(id) : frameNodeId(id));
        else setEditing({ kind, id });
      },
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
    [onHoverNote, perform, canEditMap, editing, cards, frames, mapOp, onOpenNote, phone, editLayout]
  );
  const dismissOutcome = useCallback(() => setOutcome(null), []);
  /** The id of the review walk's step (`WalkStep.id`), null when no walk is on. */
  const [walkKey, setWalkKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** The note whose inspector was closed by hand: it stays closed until another note is selected. */
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const onSelectionChange = useCallback(({ nodes: picked }: { nodes: { id: string }[] }) => {
    const key = picked.length === 1 ? picked[0].id : null;
    setSelectedKey(key);
    setClosedKey((closed) => (closed === key ? closed : null));
  }, []);
  const inspected = !phone && walkKey === null && selectedKey !== null && selectedKey !== closedKey ? graph.nodes.find((n) => n.key === selectedKey) ?? null : null;
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; label: string; items: MenuItem[] } | null>(null);
  const [create, setCreate] = useState<{ request: QuickCreateKind; anchor: string | null } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // ---- review walk (Phase 8)
  const stepWalk = useCallback((step: WalkStep) => {
    setWalkKey(step.id);
    focusNodeRef.current(step.node);
  }, []);
  const startWalk = useCallback(() => {
    const first = reviewWalk(graph)[0];
    if (!first) return setWalkKey('');
    stepWalk(first);
  }, [graph, stepWalk]);
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
  const build = useCallback((): GraphFlowNode[] => {
    const all = [
      ...toFlowFrames(frames, canEditMap),
      ...toFlowNodes(graph, placed, smells).map((n) => (editable ? n : { ...n, draggable: false })),
      ...toFlowCards(cards, canEditMap),
    ];
    // On a phone one finger pans: nothing drags unless Edit layout is on.
    return phone && !editLayout ? all.map((n) => (n.draggable === false ? n : { ...n, draggable: false })) : all;
  }, [graph, placed, editable, smells, cards, frames, canEditMap, phone, editLayout]);
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
    (all: NodeChange<GraphFlowNode>[]) => {
      const changes = keepColumn(all, nodesRef.current);
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
      // A dragged frame carries what lies inside it (what can move: not fixed points, which keep their column, not what is dragged anyway).
      const rectOf = (n: GraphFlowNode) => ({ ...n.position, width: n.width ?? n.measured?.width ?? 0, height: n.height ?? n.measured?.height ?? 0 });
      const frames = new Map(dragged.filter(isFrameNode).map((n) => [n.id, rectOf(n)]));
      const draggedIds = new Set(dragged.map((n) => n.id));
      const items = new Map(
        nodesRef.current
          .filter((n) => !n.hidden && !draggedIds.has(n.id) && n.draggable !== false && !isJunctionNode(n) && !isFixedPointNode(n))
          .map((n) => [n.id, rectOf(n)])
      );
      const carried = new Map<string, { frame: GsPosition; from: GsPosition; by: string }>();
      if (frames.size) {
        for (const [id, frame] of frameContents(frames, items)) carried.set(id, { frame: frames.get(frame)!, from: items.get(id)!, by: frame });
      }
      dragging.current = { start, movable, along: new Map(), carried };
    },
    [companions]
  );

  /** React Flow reports a dragged fixed point where the pointer has it: back in its column, as `keepColumn` draws it. */
  const inColumn = useCallback(
    (dragged: GraphFlowNode[]) =>
      dragged.map((n) => {
        const was = dragging.current?.start.get(n.id);
        return was && isFixedPointNode(n) ? { ...n, position: { x: was.x, y: n.position.y } } : n;
      }),
    []
  );

  /** Where the drag has moved the other notes now: what moves along, and what no longer does back where it was. */
  const follow = useCallback(
    (dragged: GraphFlowNode[]) => {
      const drag = dragging.current;
      if (!drag) return new Map<string, GsPosition>();
      const now = new Map(inColumn(dragged).map((n) => [n.id, n.position]));
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
    [satellites, requires, inColumn]
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
      const moved = inColumn(dragged);
      const along = dragging.current?.along ?? new Map<string, GsPosition>();
      dragging.current = null;
      if (changed.size) setNodes((current) => current.map((n) => (changed.has(n.id) ? { ...n, position: changed.get(n.id)! } : n)));
      const others = nodesRef.current.filter((n) => along.has(n.id)).map((n) => ({ ...n, position: along.get(n.id)! }));
      save([...moved, ...others]);
    },
    [follow, save, inColumn]
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
   * A frame around the selected nodes, as "Create group" on an Obsidian canvas: it holds them all with
   * some room, so dragging it carries them. Named in place, like a new frame.
   */
  const frameSelection = useCallback(() => {
    const picked = nodesRef.current.filter((n) => n.selected && !n.hidden);
    const place = frameAround(picked.map((n) => ({ ...n.position, width: n.width ?? n.measured?.width ?? 0, height: n.height ?? n.measured?.height ?? 0 })));
    if (!place) return;
    const id = freshId();
    if (!mapOp({ op: 'put-frame', frame: { id, label: '', ...place } })) return;
    setEditing({ kind: 'frame', id });
  }, [freshId, mapOp]);
  /** The menu of a selection of more than one node. */
  const openSelectionMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      if (!canEditMap) return;
      const count = nodesRef.current.filter((n) => n.selected && !n.hidden).length;
      setMenu({ at: placeOf(event), label: `${count} selected`, items: [{ label: 'Create frame around selection', run: frameSelection }] });
    },
    [canEditMap, placeOf, frameSelection]
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
  /** A card's menu items: the right-click menu, and the phone's actions sheet (`phone`: text is edited in the details sheet). */
  const cardMenu = useCallback(
    (card: GsCard, phone = false): MenuItem[] => {
      const items: MenuItem[] = [];
      if (canEditMap) {
        if (card.kind === 'text') items.push({ label: 'Edit text', run: () => (phone ? openDetailsRef.current(cardNodeId(card.id)) : setEditing({ kind: 'card', id: card.id })) });
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
      if (canEditMap) items.push({ label: 'Delete card', danger: true, run: () => void mapOp({ op: 'delete-card', id: card.id }) });
      return items;
    },
    [canEditMap, perform, onOpenNote, mapOp]
  );
  /** A frame's menu items (`phone`: it is renamed in the details sheet). */
  const frameMenu = useCallback(
    (frame: GsFrame, phone = false): MenuItem[] =>
      canEditMap
        ? [
            { label: 'Rename', run: () => (phone ? openDetailsRef.current(frameNodeId(frame.id)) : setEditing({ kind: 'frame', id: frame.id })) },
            { label: 'Style…', run: () => setEditor({ kind: 'frame', id: frame.id }) },
            { label: 'Delete frame', danger: true, run: () => void mapOp({ op: 'delete-frame', id: frame.id }) },
          ]
        : [],
    [canEditMap, mapOp]
  );
  /**
   * A note's menu: the right-click menu, and the phone's actions sheet. On a phone the note opens in
   * the graph's place only (no split), and killing a bet asks first (`confirm`).
   */
  const noteMenu = useCallback(
    (n: Graph['nodes'][number], phone = false): MenuItem[] => {
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
          items.push({
            label: 'Kill → activate next',
            disabled: why,
            danger: true,
            confirm: sequelNode ? `Kill ${n.id ?? n.basename} and activate ${sequelNode.id ?? sequelNode.basename}?` : undefined,
            run: () => void perform({ kind: 'kill-activate-next', key: n.key }),
          });
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
        items.push({ label: 'Open note', run: () => onOpenNote(n.path, false) });
        if (!phone) items.push({ label: 'Open in split', run: () => onOpenNote(n.path, true) });
      }
      return items;
    },
    [graph, perform, onOpenNote]
  );
  /** What the details sheet opens on (by React Flow id); filled in further down, once the phone's state exists. */
  const openDetailsRef = useRef<(id: string) => void>(() => {});

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, flowNode: GraphFlowNode) => {
      event.preventDefault();
      // On a phone a long-press (Android sends it as a context menu) opens the actions sheet.
      if (phone) return openActionsRef.current(flowNode.id);
      // One of several selected nodes: the menu is the selection's, as on a canvas.
      if (flowNode.selected && canEditMap && nodesRef.current.filter((n) => n.selected && !n.hidden).length > 1) return openSelectionMenu(event);
      let label: string;
      let items: MenuItem[];
      if (isCardNode(flowNode)) [label, items] = ['Card', cardMenu(flowNode.data.card)];
      else if (isFrameNode(flowNode)) [label, items] = ['Frame', frameMenu(flowNode.data.frame)];
      else if (isStrategyNode(flowNode)) [label, items] = [`Actions for ${flowNode.data.node.id ?? flowNode.data.node.basename}`, noteMenu(flowNode.data.node)];
      else return;
      if (items.length) setMenu({ at: placeOf(event), label, items });
    },
    [phone, placeOf, cardMenu, frameMenu, noteMenu, openSelectionMenu, canEditMap]
  );
  /** The phone's actions sheet for a node (by React Flow id); filled in further down. */
  const openActionsRef = useRef<(id: string) => void>(() => {});

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

  /**
   * The part of the graph's box no phone surface covers (the toolbar or rail, a docked card), in
   * pixels of the box; the whole box when nothing is shown.
   */
  const freeArea = useCallback(() => {
    const el = box.current;
    if (!el) return null;
    const outer = el.getBoundingClientRect();
    const rectOf = (selector: string) => el.querySelector(selector)?.getBoundingClientRect();
    const [bar, dock, inset] = [rectOf('.gs-phone-toolbar'), rectOf('.gs-dock'), rectOf('.gs-inset-probe')];
    // The navbar's keep-out: the probe is as tall as `--gs-inset-bottom` resolves to (env() included).
    const floor = outer.height - (inset?.height ?? 0);
    if (frame.orientation === 'landscape') {
      const left = bar ? bar.right - outer.left : 0;
      const right = dock ? dock.left - outer.left : outer.width;
      return { x: left, y: 0, width: Math.max(0, right - left), height: Math.max(0, floor) };
    }
    const top = bar ? bar.bottom - outer.top : 0;
    const bottom = Math.min(dock ? dock.top - outer.top : outer.height, floor);
    return { x: 0, y: top, width: outer.width, height: Math.max(0, bottom - top) };
  }, [box, frame.orientation]);
  /** Phone: pan the node (any kind, by React Flow id) into the free area, so the docked card never covers it. */
  const revealInFree = useCallback(
    (id: string, zoom?: number) => {
      const target = nodesRef.current.find((n) => n.id === id && !n.hidden);
      const free = freeArea();
      if (!target || !free) return;
      const rect = { ...target.position, width: target.width ?? target.measured?.width ?? 0, height: target.height ?? target.measured?.height ?? 0 };
      void flow.setViewport(panIntoFree(rect, free, flow.getViewport(), zoom), { duration: 250 });
    },
    [flow, freeArea]
  );
  /** The zoom the next phone reveal goes to (a smell or a walk step zooms in when the graph is far out). */
  const revealZoom = useRef<number | undefined>(undefined);
  /** Counts the phone reveals asked for, so asking again for the node already selected still pans to it. */
  const [revealAsked, setRevealAsked] = useState(0);

  /** Select a note and center the view on it (the smells panel, the review walk, "Reveal note in graph"). False when it isn't shown. */
  const focusNode = useCallback(
    (key: string) => {
      const target = nodesRef.current.find((n) => n.id === key && isStrategyNode(n) && !n.hidden);
      if (!target) return false;
      setNodes((current) => current.map((n) => (n.selected === (n.id === key) ? n : { ...n, selected: n.id === key })));
      // On a phone the node goes into the free area instead, once its docked card is up (the effect below).
      if (phone) {
        revealZoom.current = flow.getZoom() < 0.6 ? 0.8 : undefined;
        setRevealAsked((n) => n + 1);
        return true;
      }
      const [w, h] = [target.width ?? 0, target.height ?? 0];
      void flow.setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
      return true;
    },
    [flow, phone]
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

  // ---- the phone layout (Phase 8b, D22): sheets, the peek card, gestures.
  /** Select one node only (a long-press or double-tap selects what it opens, as a tap does). */
  const selectOnly = useCallback((id: string) => {
    setNodes((current) => current.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
  }, []);
  /** What a card's text field holds while the details sheet is open: saved (or the card deleted, when empty) on close. */
  const draft = useRef<string | null>(null);
  const openDetails = useCallback(
    (id: string) => {
      const target = nodesRef.current.find((n) => n.id === id);
      if (!target || !(isStrategyNode(target) || isCardNode(target) || isFrameNode(target))) return;
      selectOnly(id);
      draft.current = null;
      setCreate(null);
      setEditor(null);
      setSheet((open) => (open?.kind === 'details' && open.id === id ? open : { kind: 'details', id }));
    },
    [selectOnly]
  );
  openDetailsRef.current = openDetails;
  /** A long-press (or a context menu on Android): the node's actions sheet, the right-click menu's items as rows. */
  const openActions = useCallback(
    (id: string) => {
      const target = nodesRef.current.find((n) => n.id === id);
      if (!target) return;
      const details: MenuItem = { label: 'Show details', run: () => openDetails(id) };
      let title: string;
      let items: MenuItem[];
      if (isStrategyNode(target)) {
        const n = target.data.node;
        title = `${n.id ?? n.basename} ${target.data.title}`;
        const dated = n.type === 'bet' || n.type === 'assumption';
        items = [details, ...(perform && (statusesFor(n.type) || dated) ? [{ label: dated ? 'Change status or dates' : 'Change status', run: () => openDetails(id) }] : []), ...noteMenu(n, true)];
      } else if (isCardNode(target)) [title, items] = [peekOf(target)!.title, [details, ...cardMenu(target.data.card, true)]];
      else if (isFrameNode(target)) [title, items] = [peekOf(target)!.title, [details, ...frameMenu(target.data.frame, true)]];
      else return;
      selectOnly(id);
      setSheet({ kind: 'actions', title, items: items.map(confirmFirst) });
    },
    [perform, noteMenu, cardMenu, frameMenu, openDetails, selectOnly]
  );
  openActionsRef.current = openActions;
  /** An item that asks first (`confirm`) opens the confirm sheet instead of running. */
  const confirmFirst = (item: MenuItem): MenuItem =>
    item.confirm ? { ...item, run: () => setSheet({ kind: 'confirm', question: item.confirm!, label: item.label, run: item.run }) } : item;
  const closeSheet = useCallback(() => {
    setSheet((open) => {
      // A card's text is saved as the sheet closes too (a tap on the scrim may come before the field's blur is handled).
      if (open?.kind === 'details' && open.id.startsWith('card:') && draft.current !== null) {
        const card = cards.find((c) => cardNodeId(c.id) === open.id);
        if (card?.kind === 'text') {
          if (!draft.current.trim()) mapOp({ op: 'delete-card', id: card.id });
          else if (draft.current !== card.text) mapOp({ op: 'put-card', card: { ...card, text: draft.current } });
        }
      }
      draft.current = null;
      return null;
    });
  }, [cards, mapOp]);
  useTouchGestures(box, phone, { longPress: openActions, doubleTap: openDetails });

  /** The selected node, on a phone: the peek card shows it, and it is kept out from under the docked cards. */
  const selectedNode = phone && selectedKey !== null ? nodes.find((n) => n.id === selectedKey && !n.hidden) ?? null : null;
  const anySheet = sheet !== null || create !== null || editor !== null;
  const peek = selectedNode && walkKey === null && !anySheet ? peekOf(selectedNode) : null;
  const docked = phone && !anySheet && (walkKey !== null || peek !== null) ? selectedKey : null;
  useEffect(() => {
    if (docked === null) return;
    // After the docked card has been drawn, so the free area is measured with it.
    const id = requestAnimationFrame(() => {
      revealInFree(docked, revealZoom.current);
      revealZoom.current = undefined;
    });
    return () => cancelAnimationFrame(id);
  }, [docked, revealAsked, revealInFree]);

  /** A tap during the review walk goes to that note's step, if it has one. */
  const onPhoneNodeClick = useCallback(
    (_event: ReactMouseEvent, flowNode: GraphFlowNode) => {
      if (walkKey === null) return;
      const step = reviewWalk(graph).find((s) => s.node === flowNode.id);
      if (step) stepWalk(step);
    },
    [walkKey, graph, stepWalk]
  );
  /** Phone: ⋯ → Add card puts a card in the middle of the free area, and opens it in the details sheet. */
  const addCard = useCallback(() => {
    const free = freeArea();
    const outer = box.current?.getBoundingClientRect();
    if (!free || !outer) return;
    const centre = flow.screenToFlowPosition({ x: outer.left + free.x + free.width / 2, y: outer.top + free.y + free.height / 2 });
    const id = freshId();
    const at = { x: Math.round(centre.x - CARD_DEFAULT_SIZE.width / 2), y: Math.round(centre.y - CARD_DEFAULT_SIZE.height / 2) };
    if (!mapOp({ op: 'put-card', card: { id, kind: 'text', text: '', ...at, ...CARD_DEFAULT_SIZE } })) return;
    // The card is drawn on the next render: open its sheet then.
    requestAnimationFrame(() => {
      openDetails(cardNodeId(id));
      draft.current = '';
    });
  }, [freeArea, box, flow, freshId, mapOp, openDetails]);
  const openMore = () =>
    setSheet({
      kind: 'actions',
      title: 'Graph',
      items: [
        ...(notices?.length ? [{ label: `${notices.length} ${notices.length === 1 ? 'issue' : 'issues'} on the graph…`, run: () => setSheet({ kind: 'issues' }) }] : []),
        { label: showUltimate ? 'Hide ultimately-serves links' : 'Show ultimately-serves links', run: () => setShowUltimate(!showUltimate) },
        ...(canEditMap ? [{ label: 'Add card', run: addCard }] : []),
        ...(editable ? [{ label: editLayout ? 'Stop editing layout' : 'Edit layout', run: () => setEditLayout(!editLayout) }] : []),
        ...(onResetPositions
          ? [
              confirmFirst({
                label: 'Reset layout',
                danger: true,
                disabled: hasSaved ? undefined : 'No position is saved yet',
                confirm: 'Forget every saved position and lay the whole graph out automatically?',
                run: resetPositions,
              }),
            ]
          : []),
      ],
    });

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
        onNodeDoubleClick={phone ? (_event, n) => openDetails(n.id) : onNodeDoubleClick}
        onNodeClick={phone ? onPhoneNodeClick : undefined}
        onInit={onInit}
        defaultViewport={viewport ?? { x: 0, y: 0, zoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        nodesConnectable={!phone && (onEdit !== undefined || canEditMap)}
        edgesFocusable={false}
        deleteKeyCode={!phone && (onEdit || canEditMap) ? ['Backspace', 'Delete'] : null}
        onNodesDelete={onNodesDelete}
        onBeforeDelete={onBeforeDelete}
        onDoubleClickCapture={phone ? undefined : onDoubleClickCapture}
        onConnectEnd={onConnectEnd}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={phone ? preventDefault : onEdgeContextMenu}
        onPaneContextMenu={phone ? preventDefault : onPaneContextMenu}
        onSelectionContextMenu={phone ? undefined : openSelectionMenu}
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
        // On a phone (D22) one finger pans and two zoom; nothing draws a selection box.
        selectionOnDrag={!phone}
        selectionMode={SelectionMode.Partial}
        panOnDrag={phone ? true : PAN_BUTTONS}
        panOnScroll={!phone}
        panOnScrollSpeed={1}
        zoomOnPinch
        multiSelectionKeyCode={phone ? null : MULTI_SELECT_KEYS}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onKeyDownCapture={onKeyDownCapture}
        onPointerDownCapture={onPointerDownCapture}
      >
        <Background gap={20} />
        {!phone && (
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
        )}
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
        {create && perform && !phone && (
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
        {editor && editedItem && !phone && (
          <Panel position="bottom-center">
            <ItemEditor edited={editedItem} onOp={mapOp} onClose={() => setEditor(null)} />
          </Panel>
        )}
        {menu && <PopupMenu at={menu.at} items={menu.items} label={menu.label} onClose={closeMenu} />}
        <Toast outcome={outcome} onDone={dismissOutcome} />
        {!phone && (
          <Panel position="top-left" className="gs-toolbar">
            {notices && notices.length > 0 && <Notices notices={notices} onOpenNote={onOpenNote} onOp={mapOp} />}
            <SmellsPanel graph={graph} smells={smells} onFocus={focusNode} />
            <button className="gs-toolbar-button" onClick={() => (walkKey === null ? startWalk() : setWalkKey(null))} aria-pressed={walkKey !== null}>
              Review walk
            </button>
          </Panel>
        )}
        {walkKey !== null && !phone && (
          <Panel position="bottom-center">
            <ReviewWalk graph={graph} smells={smells} current={walkKey} onStep={stepWalk} onClose={() => setWalkKey(null)} />
          </Panel>
        )}
      </ReactFlow>
      {phone && (
        <PhoneChrome
          frame={frame}
          graph={graph}
          smells={smells}
          notices={notices ?? []}
          nodes={nodes}
          links={links}
          sheet={sheet}
          peek={peek}
          walkKey={walkKey}
          editLayout={editLayout}
          perform={perform}
          canEditMap={canEditMap}
          readNote={readNote}
          renderNote={renderNote}
          onOpenNote={onOpenNote}
          mapOp={mapOp}
          draft={draft}
          selectedKey={selectedKey}
          onCloseSheet={closeSheet}
          onSheet={setSheet}
          onDetails={openDetails}
          onActions={openActions}
          onFocus={focusNode}
          onFit={() => void flow.fitView({ padding: 0.1, duration: 300 })}
          onWalk={() => (walkKey === null ? startWalk() : setWalkKey(null))}
          onStep={stepWalk}
          onEndWalk={() => setWalkKey(null)}
          onMore={openMore}
          onEditDone={() => setEditLayout(false)}
        />
      )}
      {phone && create && perform && (
        <Sheet frame={frame} label={create.request.heading} onClose={() => setCreate(null)} className="gs-sheet--form">
          <QuickCreate
            request={create.request}
            anchor={create.anchor === null ? undefined : graph.nodes.find((n) => n.key === create.anchor)}
            perform={perform}
            onCreated={(outcome) => {
              const card = create.request.promote;
              if (card && outcome.created) mapOp({ op: 'promote-card', card, note: outcome.created.id });
            }}
            onClose={() => setCreate(null)}
          />
        </Sheet>
      )}
      {phone && editor && editedItem && (
        <Sheet frame={frame} label={editedItem.kind === 'card' ? 'Card style' : editedItem.kind === 'frame' ? 'Frame style' : 'Link style'} onClose={() => setEditor(null)} className="gs-sheet--form">
          <ItemEditor edited={editedItem} onOp={mapOp} onClose={() => setEditor(null)} />
        </Sheet>
      )}
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

const preventDefault = (event: { preventDefault(): void }) => event.preventDefault();

const KIND_OF_FLOW = (node: GraphFlowNode) => peekOf(node)?.kind ?? '';

/**
 * The phone's surfaces around the graph (D22): the toolbar (a row, or a rail in landscape), the
 * docked peek card or review walk, and the modal sheet that is open: details, smells, issues, actions
 * or a confirm. The forms (quick create, style) open in a sheet from the graph itself.
 */
function PhoneChrome(props: {
  frame: PhoneFrame;
  graph: Graph;
  smells: ReturnType<typeof findSmells>;
  notices: readonly GraphNotice[];
  nodes: readonly GraphFlowNode[];
  links: readonly GsLink[];
  sheet: PhoneSheet | null;
  peek: ReturnType<typeof peekOf>;
  walkKey: string | null;
  editLayout: boolean;
  perform: ((intent: Intent) => Promise<EditOutcome>) | null;
  canEditMap: boolean;
  readNote?: StrategyGraphProps['readNote'];
  renderNote?: StrategyGraphProps['renderNote'];
  onOpenNote?: StrategyGraphProps['onOpenNote'];
  mapOp: (op: GsOp) => boolean;
  draft: { current: string | null };
  selectedKey: string | null;
  onCloseSheet: () => void;
  onSheet: (sheet: PhoneSheet | null) => void;
  onDetails: (id: string) => void;
  onActions: (id: string) => void;
  onFocus: (key: string) => boolean;
  onFit: () => void;
  onWalk: () => void;
  onStep: (step: WalkStep) => void;
  onEndWalk: () => void;
  onMore: () => void;
  onEditDone: () => void;
}) {
  const { frame, graph, sheet, nodes, onCloseSheet, onOpenNote } = props;
  const pathOf = (id: string): string | null => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return null;
    if (isStrategyNode(n)) return n.data.node.path;
    if (isCardNode(n) && n.data.card.kind === 'note-ref') return n.data.card.file;
    return null;
  };
  const openNote = (id: string) => {
    const path = pathOf(id);
    return path && onOpenNote ? () => onOpenNote(path, false) : undefined;
  };
  const nameOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return id;
    const peek = peekOf(n);
    return peek ? (peek.id ? `${peek.id} ${peek.title}` : peek.title) : id;
  };
  return (
    <>
      <div className="gs-inset-probe" aria-hidden="true" />
      <PhoneToolbar
        smells={props.smells.length}
        issues={props.notices.length}
        walking={props.walkKey !== null}
        editLayout={props.editLayout}
        onFit={props.onFit}
        onSmells={() => props.onSheet({ kind: 'smells' })}
        onWalk={props.onWalk}
        onMore={props.onMore}
        onEditDone={props.onEditDone}
      />
      {props.peek && props.selectedKey && (
        <PeekCard
          peek={props.peek}
          onDetails={() => props.onDetails(props.selectedKey!)}
          onOpenNote={openNote(props.selectedKey)}
          onMore={() => props.onActions(props.selectedKey!)}
        />
      )}
      {props.walkKey !== null && sheet === null && (
        <DockCard label="Review walk" className="gs-dock--walk">
          <ReviewWalk graph={graph} smells={props.smells} current={props.walkKey} onStep={props.onStep} onClose={props.onEndWalk} docked onDetails={props.onDetails} />
        </DockCard>
      )}
      {sheet?.kind === 'details' && (() => {
        const target = nodes.find((n) => n.id === sheet.id);
        if (!target) return null;
        const peek = peekOf(target);
        const open = openNote(sheet.id);
        return (
          <Sheet
            frame={frame}
            label={`Details for ${peek?.id || peek?.title || sheet.id}`}
            onClose={onCloseSheet}
            head={
              <>
                <span className="gs-sheet-kind">
                  <span className={`gs-pill ${peek?.tone ?? ''}`}>{KIND_OF_FLOW(target)}</span>
                  {peek?.id && <span className="gs-peek-id">{peek.id}</span>}
                </span>
                <h2 className="gs-sheet-title">{peek?.title}</h2>
              </>
            }
            foot={
              <>
                <button type="button" className="gs-icon-button" aria-label="More actions" onClick={() => props.onActions(sheet.id)}>
                  <Icon name="more" />
                </button>
                {open && (
                  <button type="button" className="gs-sheet-wide" onClick={open}>
                    <Icon name="file" />
                    Open note
                  </button>
                )}
              </>
            }
          >
            {isStrategyNode(target) ? (
              <Inspector
                graph={graph}
                node={target.data.node}
                perform={props.perform}
                readNote={props.readNote}
                renderNote={props.renderNote}
                onOpenNote={onOpenNote}
                onClose={onCloseSheet}
                variant="sheet"
              />
            ) : isCardNode(target) || isFrameNode(target) ? (
              <FreeItemDetails
                item={isCardNode(target) ? { kind: 'card', card: target.data.card } : { kind: 'frame', frame: target.data.frame }}
                links={props.links}
                targets={nodes.filter((n) => (isStrategyNode(n) || isCardNode(n)) && !n.hidden).map((n) => ({ id: n.id, label: nameOf(n.id) }))}
                nameOf={nameOf}
                onOp={props.mapOp}
                draft={props.draft}
                editable={props.canEditMap}
              />
            ) : null}
          </Sheet>
        );
      })()}
      {sheet?.kind === 'smells' && (
        <Sheet
          frame={frame}
          label="Smells"
          onClose={onCloseSheet}
          head={
            <span className="gs-sheet-title">
              Smells <span className="gs-count">{props.smells.length}</span>
            </span>
          }
        >
          <div className="gs-smells-list gs-smells-list--sheet">
            <SmellsList
              graph={graph}
              smells={props.smells}
              messages
              onFocus={(key) => {
                onCloseSheet();
                props.onFocus(key);
              }}
            />
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'issues' && (
        <Sheet frame={frame} label="Issues" onClose={onCloseSheet}>
          <NoticesList notices={props.notices} onOpenNote={onOpenNote} onOp={props.mapOp} />
        </Sheet>
      )}
      {sheet?.kind === 'actions' && <ActionSheet frame={frame} title={sheet.title} items={sheet.items} onClose={onCloseSheet} />}
      {sheet?.kind === 'confirm' && (
        <Sheet
          frame={frame}
          label={sheet.label}
          onClose={onCloseSheet}
          foot={
            <>
              <button type="button" className="gs-sheet-wide" onClick={onCloseSheet}>
                Cancel
              </button>
              <button
                type="button"
                className="gs-sheet-wide mod-warning"
                onClick={() => {
                  onCloseSheet();
                  sheet.run();
                }}
              >
                {sheet.label.replace(/…$/, '')}
              </button>
            </>
          }
        >
          <p className="gs-confirm-question">{sheet.question}</p>
        </Sheet>
      )}
    </>
  );
}

function Notices({
  notices,
  onOpenNote,
  onOp,
}: {
  notices: readonly GraphNotice[];
  onOpenNote?: StrategyGraphProps['onOpenNote'];
  onOp: (op: GsOp) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const errors = notices.filter((n) => n.severity === 'error').length;
  const label = `${notices.length} ${notices.length === 1 ? 'issue' : 'issues'}`;
  return (
    <div className={`gs-notices${errors ? ' has-errors' : ''}`}>
      <button className="gs-notices-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </button>
      {open && <NoticesList notices={notices} onOpenNote={onOpenNote} onOp={onOp} />}
    </div>
  );
}

/** The issues on the graph (graph issues, changed ids, an unreadable `.gsmap`): the desktop panel's list, and the phone's issues sheet. */
function NoticesList({ notices, onOpenNote, onOp }: { notices: readonly GraphNotice[]; onOpenNote?: StrategyGraphProps['onOpenNote']; onOp: (op: GsOp) => boolean }) {
  return (
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
          {notice.action && (
            <button className="gs-notice-action" onClick={() => onOp(notice.action!.op)}>
              {notice.action.label}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
