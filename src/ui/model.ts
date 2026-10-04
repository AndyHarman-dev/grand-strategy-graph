/**
 * Graph + positions → what React Flow draws. Pure, so the mapping is unit-tested without a DOM.
 * The look itself (shapes, colours, dashes) is `graph.css`; this decides the classes and data it needs.
 */
import type { Edge, Node } from '@xyflow/react';
import type { GsCard, GsFrame, GsLink, GsPosition } from '../core/gsmap';
import { canPin, flowOf, HIDDEN_EDGE_KINDS, NODE_SIZES, type Size } from '../core/layout';
import type { Graph, GraphNode } from '../core/schema';
import type { Smell } from '../core/smells';

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
/** Everything on the graph that is a node. */
export type GraphFlowNode = StrategyFlowNode | CardFlowNode | FrameFlowNode;

export const cardNodeId = (id: string) => `card:${id}`;
export const frameNodeId = (id: string) => `frame:${id}`;
export const linkEdgeId = (id: string) => `link:${id}`;
export const isStrategyNode = (node: { type?: string }): node is StrategyFlowNode => node.type === NODE_TYPE;
export const isCardNode = (node: { type?: string }): node is CardFlowNode => node.type === CARD_TYPE;
export const isFrameNode = (node: { type?: string }): node is FrameFlowNode => node.type === FRAME_TYPE;

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
 * is hidden rather than drawn at the origin. Fixed points are locked (plan Phase 5a).
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
      draggable: pinnable && node.type !== 'fixed-point',
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

export interface EdgeView {
  /** Smells, for the bets with no `serves` chain: their `ultimately-serves` shows (plan Schema section). */
  smells?: readonly Smell[];
  /** The toggle: show every `ultimately-serves` edge, not only a chainless bet's. */
  showUltimate?: boolean;
  /** Edits are possible: a link can be selected and removed. */
  editable?: boolean;
}

/** One React Flow edge per graph edge, attached to the sides that face each other at `positions`. */
export function toFlowEdges(graph: Graph, positions: Readonly<Record<string, GsPosition>>, view: EdgeView = {}): Edge[] {
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));
  const unverified = unverifiedServes(graph);
  const chainless = new Set((view.smells ?? []).filter((s) => s.code === 'orphan-bet').map((s) => s.node));
  return graph.edges.map((edge) => {
    const { source, target } = flowOf(edge);
    const [from, to] = [positions[source], positions[target]];
    const alongTime = edge.kind === 'serves' || edge.kind === 'requires';
    const sides =
      from && to ? sidesOf({ ...from, ...NODE_SIZES[typeOf.get(source)!] }, { ...to, ...NODE_SIZES[typeOf.get(target)!] }, alongTime) : null;
    const hiddenKind = HIDDEN_EDGE_KINDS.includes(edge.kind);
    const shown = !hiddenKind || view.showUltimate === true || chainless.has(edge.from);
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
      ...(edge.kind === 'assumption' ? {} : { markerEnd: { type: 'arrowclosed' as const } }),
      data: { kind: edge.kind },
    } satisfies Edge;
  });
}

/**
 * The assumptions that move with a drag (D19): those hosted by a dragged node, unless they are
 * being dragged themselves. Keyed by assumption, valued by its host.
 */
export function followersOf(satellites: ReadonlyMap<string, readonly string[]>, dragged: readonly string[]): Map<string, string> {
  const draggedSet = new Set(dragged);
  const out = new Map<string, string>();
  for (const host of dragged) for (const key of satellites.get(host) ?? []) if (!draggedSet.has(key)) out.set(key, host);
  return out;
}

/** Positions to save after a drag: by note id, only for nodes that can be pinned. */
export function movedPositions(nodes: readonly Pick<GraphFlowNode, 'id' | 'position' | 'data' | 'type'>[]): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of nodes) {
    if (!isStrategyNode(node)) continue;
    if (node.data.pinnable && node.data.node.type !== 'fixed-point') out[node.data.node.id!] = { x: node.position.x, y: node.position.y };
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

export function toFlowFrames(frames: readonly GsFrame[], editable: boolean): FrameFlowNode[] {
  return frames.map((frame) => ({
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
