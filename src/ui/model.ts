/**
 * Graph + positions → what React Flow draws. Pure, so the mapping is unit-tested without a DOM.
 * Styling beyond a class per type, status and edge kind is Phase 5b.
 */
import type { Edge, Node } from '@xyflow/react';
import type { GsPosition } from '../core/gsmap';
import { canPin, flowOf, HIDDEN_EDGE_KINDS, NODE_SIZES } from '../core/layout';
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

export function toFlowEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => {
    const { source, target } = flowOf(edge);
    return {
      id: edge.key,
      source,
      target,
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

/** Positions to save after a drag: by note id, only for nodes that can be pinned. */
export function movedPositions(nodes: readonly Pick<StrategyFlowNode, 'id' | 'position' | 'data'>[]): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of nodes) {
    if (node.data.pinnable && node.data.node.type !== 'fixed-point') out[node.data.node.id!] = { x: node.position.x, y: node.position.y };
  }
  return out;
}
