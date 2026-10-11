/**
 * Graph + positions → what React Flow draws. Pure, so the mapping is unit-tested without a DOM.
 * The look itself (shapes, colours, dashes) is `graph.css`; this decides the classes and data it needs.
 */
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import type { GsCard, GsFrame, GsLink, GsPosition } from '../core/gsmap';
import { canPin, flowOf, HIDDEN_EDGE_KINDS, NODE_SIZES, type Size } from '../core/layout';
import type { Graph, GraphNode } from '../core/schema';
import type { Smell, SmellCode } from '../core/smells';

export const NODE_TYPE = 'strategy';

export type StrategyNodeData = {
  node: GraphNode;
  title: string;
  /** False when the note has no unique `id`: its position could not be saved, so it can't be dragged. */
  pinnable: boolean;
  /** What `findSmells` found on this note, for the badge. */
  smells: readonly Smell[];
};

export type StrategyFlowNode = Node<StrategyNodeData, typeof NODE_TYPE>;

/** Free cards and frames (Phase 7) are React Flow nodes too, with ids that can never be a note's key. */
export const CARD_TYPE = 'card';
export const FRAME_TYPE = 'frame';
export type CardFlowNode = Node<{ card: GsCard }, typeof CARD_TYPE>;
export type FrameFlowNode = Node<{ frame: GsFrame }, typeof FRAME_TYPE>;
/** The "AND" in front of a note that requires two or more others: drawn from the links, never stored. */
export const JUNCTION_TYPE = 'junction';
export type JunctionFlowNode = Node<{ holder: string; prerequisites: readonly string[] }, typeof JUNCTION_TYPE>;
/** Everything on the graph that is a node. */
export type GraphFlowNode = StrategyFlowNode | CardFlowNode | FrameFlowNode | JunctionFlowNode;

export const cardNodeId = (id: string) => `card:${id}`;
export const frameNodeId = (id: string) => `frame:${id}`;
export const linkEdgeId = (id: string) => `link:${id}`;
export const isStrategyNode = (node: { type?: string }): node is StrategyFlowNode => node.type === NODE_TYPE;
export const isCardNode = (node: { type?: string }): node is CardFlowNode => node.type === CARD_TYPE;
export const isFrameNode = (node: { type?: string }): node is FrameFlowNode => node.type === FRAME_TYPE;
export const isJunctionNode = (node: { type?: string }): node is JunctionFlowNode => node.type === JUNCTION_TYPE;
export const junctionNodeId = (holder: string) => `and:${holder}`;

/** The note's title without its id prefix: `B-10  byTalent backend` → `byTalent backend`. */
export function titleOf(node: Pick<GraphNode, 'id' | 'basename'>): string {
  const { id, basename } = node;
  if (id && basename.startsWith(id)) {
    const rest = basename.slice(id.length).trim();
    if (rest) return rest;
  }
  return basename;
}

/**
 * One React Flow node per graph node. A node without a position yet (layout still running)
 * is hidden rather than drawn at the origin. Fixed points drag up and down only (`keepColumn`):
 * the layout keeps them in one column.
 */
export function toFlowNodes(
  graph: Graph,
  positions: Readonly<Record<string, GsPosition>>,
  smells: readonly Smell[] = []
): StrategyFlowNode[] {
  const smellsOf = groupSmells(smells);
  return graph.nodes.map((node) => {
    const size = NODE_SIZES[node.type];
    const position = positions[node.key];
    const pinnable = canPin(node);
    return {
      id: node.key,
      type: NODE_TYPE,
      position: position ? { x: position.x, y: position.y } : { x: 0, y: 0 },
      hidden: !position,
      draggable: pinnable,
      // Each handle decides for itself (read-only graphs make them all unconnectable); a node is never deleted.
      connectable: true,
      deletable: false,
      width: size.width,
      height: size.height,
      style: { width: size.width, height: size.height },
      data: { node, title: titleOf(node), pinnable, smells: smellsOf.get(node.key) ?? [] },
    };
  });
}

/** Smells by the key of the node they are on. */
export function groupSmells(smells: readonly Smell[]): Map<string, Smell[]> {
  const out = new Map<string, Smell[]>();
  for (const smell of smells) out.set(smell.node, [...(out.get(smell.node) ?? []), smell]);
  return out;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Which sides an edge leaves and enters by (D19). `serves` and `requires` run along the time axis,
 * so they use left/right whenever their ends are apart across at all. Other edges (an assumption
 * leader, a sequel below its bet) take the sides that face each other: left/right when the boxes
 * are further apart across than up and down, top/bottom otherwise.
 */
export function sidesOf(source: GsPosition & Size, target: GsPosition & Size, alongTime = false): { source: Side; target: Side } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  const across = Math.abs(dx) - (source.width + target.width) / 2;
  const down = Math.abs(dy) - (source.height + target.height) / 2;
  const horizontal = alongTime ? Math.abs(dx) >= ALIGNED : across >= down;
  const side: Side = horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  return { source: side, target: OPPOSITE[side] };
}

/** Centers closer than this across count as one column. */
const ALIGNED = 20;

/** Handle ids on every node: one source and one target handle per side. */
export const handleId = (side: Side, type: 'source' | 'target') => `${side}-${type}`;

/**
 * Keys of the `serves` edges drawn dashed: the holder (a bet or a milestone) leans on an assumption
 * that is not `confirmed`, so what it claims to serve is not yet established ("Unverified serve:
 * dashed", plan Schema section).
 */
export function unverifiedServes(graph: Graph): Set<string> {
  const status = new Map(graph.nodes.map((n) => [n.key, n.status]));
  const shaky = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === 'assumption' && status.get(edge.to) !== 'confirmed') shaky.add(edge.from);
  }
  return new Set(graph.edges.filter((e) => e.kind === 'serves' && shaky.has(e.from)).map((e) => e.key));
}

// ------------------------------------------------------------------ "AND" junctions

/** A note that requires two or more others: all of them must be done first, so their links meet in an "AND". */
export interface Junction {
  holder: string;
  /** Keys of what it requires, in edge order. */
  prerequisites: string[];
}

/** The junction box: a small diamond, with this much room on each side between it and its holder. */
export const JUNCTION_SIZE = 36;
const JUNCTION_GAP = 32;

/** Junctions by holder key: every note with two or more `requires`. */
export function junctionsOf(graph: Graph): Map<string, Junction> {
  const required = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.kind === 'requires') required.set(edge.from, [...(required.get(edge.from) ?? []), edge.to]);
  const out = new Map<string, Junction>();
  for (const [holder, prerequisites] of required) if (prerequisites.length > 1) out.set(holder, { holder, prerequisites });
  return out;
}

/** Where a junction sits: just left of its holder, level with its middle. It goes wherever the holder goes. */
export function junctionRect(holder: GsPosition & Size): GsPosition & Size {
  return {
    x: holder.x - JUNCTION_GAP - JUNCTION_SIZE,
    y: holder.y + holder.height / 2 - JUNCTION_SIZE / 2,
    width: JUNCTION_SIZE,
    height: JUNCTION_SIZE,
  };
}

/** One handle of each kind per side, at the middle of the side, as the node component draws them. */
const JUNCTION_HANDLES: NodeHandle[] = (
  [
    ['top', Position.Top, JUNCTION_SIZE / 2, 0],
    ['right', Position.Right, JUNCTION_SIZE, JUNCTION_SIZE / 2],
    ['bottom', Position.Bottom, JUNCTION_SIZE / 2, JUNCTION_SIZE],
    ['left', Position.Left, 0, JUNCTION_SIZE / 2],
  ] as const
).flatMap(([side, position, x, y]) => (['source', 'target'] as const).map((type) => ({ id: handleId(side, type), type, position, x, y, width: 1, height: 1 })));

/**
 * The junction nodes for the holders drawn at `positions`. They are rebuilt whenever a holder moves,
 * so they carry their size and handles themselves: React Flow then never has to measure them, and
 * their edges never blink out.
 */
export function toFlowJunctions(graph: Graph, junctions: ReadonlyMap<string, Junction>, positions: Readonly<Record<string, GsPosition>>): JunctionFlowNode[] {
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));
  const out: JunctionFlowNode[] = [];
  for (const junction of junctions.values()) {
    const at = positions[junction.holder];
    const type = typeOf.get(junction.holder);
    if (!at || !type) continue;
    const rect = junctionRect({ ...at, ...NODE_SIZES[type] });
    out.push({
      id: junctionNodeId(junction.holder),
      type: JUNCTION_TYPE,
      position: { x: rect.x, y: rect.y },
      width: JUNCTION_SIZE,
      height: JUNCTION_SIZE,
      measured: { width: JUNCTION_SIZE, height: JUNCTION_SIZE },
      handles: JUNCTION_HANDLES,
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false,
      focusable: false,
      data: { holder: junction.holder, prerequisites: junction.prerequisites },
    });
  }
  return out;
}

export interface EdgeView {
  /** Smells, for the bets with no `serves` chain: their `ultimately-serves` shows (plan Schema section). */
  smells?: readonly Smell[];
  /** The toggle: show every `ultimately-serves` edge, not only a chainless bet's. */
  showUltimate?: boolean;
  /** Edits are possible: a link can be selected and removed. */
  editable?: boolean;
  /** "AND" junctions (`junctionsOf`): the `requires` of their holder run into the junction, which runs into the holder. */
  junctions?: ReadonlyMap<string, Junction>;
}

/**
 * One React Flow edge per graph edge, attached to the sides that face each other at `positions`.
 * A `requires` already says what its `serves` twin says (the prerequisite serves its holder), so
 * that `serves` is not drawn a second time. A note with two or more `requires` gets an "AND": its
 * prerequisites' links end there, and one link runs from it to the note.
 */
export function toFlowEdges(graph: Graph, positions: Readonly<Record<string, GsPosition>>, view: EdgeView = {}): Edge[] {
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));
  const unverified = unverifiedServes(graph);
  const chainless = new Set((view.smells ?? []).filter((s) => s.code === 'orphan-bet').map((s) => s.node));
  const junctions = view.junctions ?? new Map<string, Junction>();
  const required = new Set(graph.edges.filter((e) => e.kind === 'requires').map((e) => `${e.to}>${e.from}`));
  const rectOf = (key: string): (GsPosition & Size) | null => {
    const at = positions[key];
    return at && typeOf.has(key) ? { ...at, ...NODE_SIZES[typeOf.get(key)!] } : null;
  };
  const edges: Edge[] = graph.edges.map((edge) => {
    const { source, target: holderEnd } = flowOf(edge);
    const junction = edge.kind === 'requires' ? junctions.get(edge.from) : undefined;
    const target = junction ? junctionNodeId(junction.holder) : holderEnd;
    const from = rectOf(source);
    const to = junction ? (rectOf(holderEnd) && junctionRect(rectOf(holderEnd)!)) : rectOf(target);
    const alongTime = edge.kind === 'serves' || edge.kind === 'requires';
    const sides = from && to ? sidesOf(from, to, alongTime) : null;
    const hiddenKind = HIDDEN_EDGE_KINDS.includes(edge.kind);
    const twin = edge.kind === 'serves' && required.has(`${edge.from}>${edge.to}`);
    const shown = !twin && (!hiddenKind || view.showUltimate === true || chainless.has(edge.from));
    return {
      id: edge.key,
      source,
      target,
      ...(sides ? { sourceHandle: handleId(sides.source, 'source'), targetHandle: handleId(sides.target, 'target') } : {}),
      className: `gs-edge gs-edge-${edge.kind}${unverified.has(edge.key) ? ' gs-edge-unverified' : ''}`,
      hidden: !shown,
      deletable: view.editable === true,
      selectable: view.editable === true,
      interactionWidth: 12,
      ...(edge.kind === 'next' ? { label: 'on kill' } : {}),
      ...(edge.kind === 'ultimately-serves' ? { label: 'ultimately' } : {}),
      // Links meeting in an "AND" end without arrowheads; the one from the "AND" to the note has it.
      ...(edge.kind === 'assumption' || junction ? {} : { markerEnd: { type: 'arrowclosed' as const } }),
      data: { kind: edge.kind },
    } satisfies Edge;
  });
  for (const junction of junctions.values()) {
    const holder = rectOf(junction.holder);
    const sides = holder ? sidesOf(junctionRect(holder), holder, true) : null;
    edges.push({
      id: `${junctionNodeId(junction.holder)}>`,
      source: junctionNodeId(junction.holder),
      target: junction.holder,
      ...(sides ? { sourceHandle: handleId(sides.source, 'source'), targetHandle: handleId(sides.target, 'target') } : {}),
      className: 'gs-edge gs-edge-requires gs-edge-junction',
      deletable: false,
      selectable: false,
      focusable: false,
      markerEnd: { type: 'arrowclosed' as const },
      data: { kind: 'junction' },
    });
  }
  return edges;
}

/** A prerequisite pushed by a drag keeps the gap it had to what requires it, but never needs more than a column's (ELK's 100). */
export const PREREQUISITE_GAP = 100;

/** Holder → the keys it `requires`. */
export function requiresOf(graph: Graph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.kind === 'requires') out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  return out;
}

/**
 * What moves along with a drag (or an arrow-key nudge), besides the dragged nodes themselves:
 *
 * - the assumptions a moved note hosts, by the same amount (D19);
 * - the notes a dragged note `requires`, and theirs in turn: time runs left to right, so a
 *   prerequisite is pushed left, and only left, when the note that requires it would come closer
 *   than the gap they had when the drag began (`PREREQUISITE_GAP` at most). It never follows the
 *   drag up or down, and goes back to where it was if the drag goes back. A prerequisite that was
 *   not left of its note to begin with is left alone.
 *
 * `start` has the shown notes where they were when the drag began; `movable` the ones that may be
 * moved (saved by id, not fixed points); `moved` the dragged nodes where they are now. Returns the
 * new position of every other node that moves.
 */
export function dragCompanions(input: {
  satellites: ReadonlyMap<string, readonly string[]>;
  requires: ReadonlyMap<string, readonly string[]>;
  start: ReadonlyMap<string, GsPosition & Size>;
  movable: ReadonlySet<string>;
  moved: ReadonlyMap<string, GsPosition>;
}): Map<string, GsPosition> {
  const { satellites, requires, start, movable, moved } = input;
  const out = new Map<string, GsPosition>();
  const now = (key: string) => moved.get(key) ?? out.get(key) ?? start.get(key);
  // Prerequisites, outward from the dragged nodes. A push only ever lowers x, so this ends.
  const queue = Array.from(moved.keys());
  for (let guard = 0; queue.length && guard < 10_000; guard++) {
    const holder = queue.shift()!;
    const [from, at] = [start.get(holder), now(holder)];
    if (!from || !at) continue;
    for (const key of requires.get(holder) ?? []) {
      const was = start.get(key);
      if (!was || moved.has(key) || !movable.has(key)) continue;
      const gap = from.x - (was.x + was.width);
      if (gap < 0) continue;
      const x = Math.min(was.x, out.get(key)?.x ?? was.x, at.x - Math.min(gap, PREREQUISITE_GAP) - was.width);
      if (x >= (out.get(key)?.x ?? was.x)) continue;
      out.set(key, { x, y: was.y });
      queue.push(key);
    }
  }
  // Hosted assumptions go with their host, dragged or pushed.
  for (const host of [...moved.keys(), ...out.keys()]) {
    const [from, at] = [start.get(host), now(host)];
    if (!from || !at) continue;
    for (const key of satellites.get(host) ?? []) {
      const was = start.get(key);
      if (!was || moved.has(key) || out.has(key)) continue;
      out.set(key, { x: was.x + at.x - from.x, y: was.y + at.y - from.y });
    }
  }
  return out;
}

/**
 * What a dragged frame carries, as on an Obsidian canvas: every other node that lies wholly inside
 * it when the drag begins (notes, cards, frames nested in it). Keyed by node id, valued by the frame
 * that carries it (the first one that holds it, for a node inside two dragged frames).
 */
export function frameContents(frames: ReadonlyMap<string, GsPosition & Size>, items: ReadonlyMap<string, GsPosition & Size>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [frame, f] of frames) {
    for (const [id, r] of items) {
      if (id === frame || out.has(id) || frames.has(id)) continue;
      if (holds(f, r)) out.set(id, frame);
    }
  }
  return out;
}

/** Whether `inner` lies wholly inside `outer`. */
export function holds(outer: GsPosition & Size, inner: GsPosition & Size): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export const isFixedPointNode = (node: { type?: string; data?: unknown }): boolean => isStrategyNode(node) && (node as StrategyFlowNode).data.node.type === 'fixed-point';

/**
 * Fixed points share one column (`placeNodes`), so they move up and down only: each position
 * change for one keeps the x it has in `nodes`.
 */
export function keepColumn<C extends { type: string; id?: string; position?: GsPosition }>(changes: readonly C[], nodes: readonly GraphFlowNode[]): C[] {
  const fixedX = new Map(nodes.filter(isFixedPointNode).map((n) => [n.id, n.position.x]));
  return changes.map((c) => (c.type === 'position' && c.position && c.id !== undefined && fixedX.has(c.id) ? { ...c, position: { x: fixedX.get(c.id)!, y: c.position.y } } : c));
}

/** Positions to save after a drag: by note id, only for nodes that can be pinned. */
export function movedPositions(nodes: readonly Pick<GraphFlowNode, 'id' | 'position' | 'data' | 'type'>[]): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of nodes) {
    if (!isStrategyNode(node)) continue;
    if (node.data.pinnable) out[node.data.node.id!] = { x: node.position.x, y: node.position.y };
  }
  return out;
}

/**
 * Positions to save along with a drag so that nothing else moves: every node on screen that can
 * be pinned and has no saved position yet, fixed points included, where it is drawn now. Without
 * them, the layout re-places unsaved nodes around the dropped ones.
 */
export function unsavedPositions(
  nodes: readonly Pick<GraphFlowNode, 'position' | 'hidden' | 'data' | 'type'>[],
  saved: Readonly<Record<string, GsPosition>>
): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of nodes) {
    if (!isStrategyNode(node)) continue;
    const id = node.data.node.id;
    if (node.hidden || !node.data.pinnable || id === null || Object.prototype.hasOwnProperty.call(saved, id)) continue;
    out[id] = { x: node.position.x, y: node.position.y };
  }
  return out;
}

/** Today's local date as `YYYY-MM-DD`. */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}


// ------------------------------------------------------------------ free cards, frames, links (Phase 7)

/** Canvas colour presets "1"–"6" as Obsidian's palette; a hex string is used as it is. */
const PRESET_COLORS: Record<string, string> = {
  '1': 'var(--color-red, #fb464c)',
  '2': 'var(--color-orange, #e9973f)',
  '3': 'var(--color-yellow, #e0de71)',
  '4': 'var(--color-green, #44cf6e)',
  '5': 'var(--color-cyan, #53dfdd)',
  '6': 'var(--color-purple, #a882ff)',
};

/** The colours a card, frame or link can be given, in the order the style editor offers them. */
export const COLOR_CHOICES: readonly { value: string | null; label: string }[] = [
  { value: null, label: 'none' },
  { value: '1', label: 'red' },
  { value: '2', label: 'orange' },
  { value: '3', label: 'yellow' },
  { value: '4', label: 'green' },
  { value: '5', label: 'cyan' },
  { value: '6', label: 'purple' },
];

/** The CSS colour for a canvas colour value, or undefined when there is none (or it isn't one we know). */
export function cssColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (PRESET_COLORS[color]) return PRESET_COLORS[color];
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}

export const CARD_DEFAULT_SIZE: Size = { width: 250, height: 60 };
export const FRAME_DEFAULT_SIZE: Size = { width: 400, height: 300 };

export function toFlowCards(cards: readonly GsCard[], editable: boolean): CardFlowNode[] {
  return cards.map((card) => ({
    id: cardNodeId(card.id),
    type: CARD_TYPE,
    position: { x: card.x, y: card.y },
    width: card.width,
    height: card.height,
    draggable: editable,
    connectable: true,
    deletable: editable,
    data: { card },
  }));
}

/** Room a frame made around a selection leaves on each side, and more at the top, where its label sits. */
export const FRAME_PADDING = { side: 20, top: 44 };

/** The place of a frame made around these nodes (as a canvas group made from a selection), or null for none. */
export function frameAround(rects: readonly (GsPosition & Size)[]): (GsPosition & Size) | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.x)) - FRAME_PADDING.side;
  const top = Math.min(...rects.map((r) => r.y)) - FRAME_PADDING.top;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + FRAME_PADDING.side;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + FRAME_PADDING.side;
  const [x, y] = [Math.floor(left), Math.floor(top)];
  return { x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
}

export function toFlowFrames(frames: readonly GsFrame[], editable: boolean): FrameFlowNode[] {
  // The bigger frame behind: one made around another is drawn under it, so the inner one stays in view.
  const area = (frame: GsFrame) => frame.width * frame.height;
  return [...frames].sort((a, b) => area(b) - area(a)).map((frame) => ({
    id: frameNodeId(frame.id),
    type: FRAME_TYPE,
    position: { x: frame.x, y: frame.y },
    width: frame.width,
    height: frame.height,
    // A frame is a backdrop: behind the notes and cards that sit on it.
    zIndex: -1,
    draggable: editable,
    connectable: false,
    deletable: editable,
    data: { frame },
  }));
}

/** What a link end points at, as a React Flow node id. */
export const endpointNodeId = (end: GsLink['from']): string => ('card' in end ? cardNodeId(end.card) : end.note);

/** The dash pattern class for a link's `path` style (canvas styleAttributes). */
function linkDash(link: GsLink): string | null {
  switch (link.style?.path) {
    case 'dotted':
      return 'gs-link--dotted';
    case 'short-dashed':
      return 'gs-link--short-dashed';
    case 'long-dashed':
      return 'gs-link--long-dashed';
    default:
      return null;
  }
}

/**
 * The map's links as edges. A link whose end is not on the graph (a note that is gone) is left out;
 * the session reports it. Sides come from the link when it has them (the canvas's), else face
 * each other like the relation edges do.
 */
export function toFlowLinks(links: readonly GsLink[], rects: ReadonlyMap<string, GsPosition & Size>, editable: boolean): Edge[] {
  const out: Edge[] = [];
  for (const link of links) {
    const [source, target] = [endpointNodeId(link.from), endpointNodeId(link.to)];
    const [from, to] = [rects.get(source), rects.get(target)];
    if (!from || !to) continue;
    const facing = sidesOf(from, to);
    const classes = ['gs-link'];
    const dash = linkDash(link);
    if (dash) classes.push(dash);
    const color = cssColor(link.color);
    out.push({
      id: linkEdgeId(link.id),
      source,
      target,
      sourceHandle: handleId(link.fromSide ?? facing.source, 'source'),
      targetHandle: handleId(link.toSide ?? facing.target, 'target'),
      type: link.style?.pathfindingMethod === 'square' ? 'smoothstep' : 'default',
      className: classes.join(' '),
      ...(color ? { style: { stroke: color } } : {}),
      ...(link.label ? { label: link.label } : {}),
      ...(link.fromEnd === 'arrow' ? { markerStart: { type: 'arrowclosed' as const } } : {}),
      ...(link.toEnd === 'none' ? {} : { markerEnd: { type: 'arrowclosed' as const } }),
      deletable: editable,
      selectable: editable,
      interactionWidth: 12,
      data: { kind: 'link', link },
    });
  }
  return out;
}


// ------------------------------------------------------------------ smells panel (Phase 8)

/** What each smell means, worst first: the order the panel lists them in. */
export const SMELL_GROUPS: readonly { code: SmellCode; title: string }[] = [
  { code: 'gating-violation', title: 'Active on assumptions with no verify-by' },
  { code: 'falsified-dependency', title: 'Active on falsified assumptions' },
  { code: 'requires-open-milestone', title: 'Active, but requires a milestone not reached' },
  { code: 'overdue-bet', title: 'Past its deadline while active' },
  { code: 'orphan-bet', title: 'No serves chain to a fixed point' },
  { code: 'unreached-fixed-point', title: 'Fixed point nothing serves' },
  { code: 'dormant-not-next', title: 'Dormant, and no bet\'s next' },
];

/** The smells in the panel's groups, each group in the smells' own order (by node). Empty groups are left out. */
export function groupSmellsForPanel(smells: readonly Smell[]): { code: SmellCode; title: string; smells: Smell[] }[] {
  return SMELL_GROUPS.map((group) => ({ ...group, smells: smells.filter((s) => s.code === group.code) })).filter((group) => group.smells.length > 0);
}
