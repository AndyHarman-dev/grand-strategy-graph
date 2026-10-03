/**
 * Graph + positions → what React Flow draws. Pure, so the mapping is unit-tested without a DOM.
 * Styling beyond a class per type, status and edge kind is Phase 5b.
 */
import type { Edge, Node } from '@xyflow/react';
import type { GsPosition } from '../core/gsmap';
import { canPin, flowOf, HIDDEN_EDGE_KINDS, NODE_SIZES, type Size } from '../core/layout';
import type { Graph, GraphNode } from '../core/schema';

export const NODE_TYPE = 'strategy';

export type StrategyNodeData = {
  node: GraphNode;
  title: string;
  /** False when the note has no unique `id`: its position could not be saved, so it can't be dragged. */
  pinnable: boolean;
};

export type StrategyFlowNode = Node<StrategyNodeData, typeof NODE_TYPE>;

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
export function toFlowNodes(graph: Graph, positions: Readonly<Record<string, GsPosition>>): StrategyFlowNode[] {
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
      connectable: false,
      deletable: false,
      width: size.width,
      height: size.height,
      style: { width: size.width, height: size.height },
      data: { node, title: titleOf(node), pinnable },
    };
  });
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

/** One React Flow edge per graph edge, attached to the sides that face each other at `positions`. */
export function toFlowEdges(graph: Graph, positions: Readonly<Record<string, GsPosition>>): Edge[] {
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));
  return graph.edges.map((edge) => {
    const { source, target } = flowOf(edge);
    const [from, to] = [positions[source], positions[target]];
    const alongTime = edge.kind === 'serves' || edge.kind === 'requires';
    const sides =
      from && to ? sidesOf({ ...from, ...NODE_SIZES[typeOf.get(source)!] }, { ...to, ...NODE_SIZES[typeOf.get(target)!] }, alongTime) : null;
    return {
      id: edge.key,
      source,
      target,
      ...(sides ? { sourceHandle: handleId(sides.source, 'source'), targetHandle: handleId(sides.target, 'target') } : {}),
      className: `gs-edge gs-edge-${edge.kind}`,
      hidden: HIDDEN_EDGE_KINDS.includes(edge.kind),
      deletable: false,
      selectable: false,
      ...(edge.kind === 'next' ? { label: 'on kill' } : {}),
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
export function movedPositions(nodes: readonly Pick<StrategyFlowNode, 'id' | 'position' | 'data'>[]): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of nodes) {
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
  nodes: readonly Pick<StrategyFlowNode, 'position' | 'hidden' | 'data'>[],
  saved: Readonly<Record<string, GsPosition>>
): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of nodes) {
    const id = node.data.node.id;
    if (node.hidden || !node.data.pinnable || id === null || Object.prototype.hasOwnProperty.call(saved, id)) continue;
    out[id] = { x: node.position.x, y: node.position.y };
  }
  return out;
}
