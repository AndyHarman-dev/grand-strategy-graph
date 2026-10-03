/**
 * Where each node goes on the graph (plan Phase 5a). Saved positions (`.gsmap`, by note id) are
 * kept exactly. Nodes without one are placed by ELK's layered algorithm, left to right: current
 * position, then bets layered along their `serves` chains, milestones, and fixed points last.
 * Pure: ELK is plain JavaScript, so this runs in Node (tests, dev page) and in Obsidian alike.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { GsPosition } from './gsmap';
import type { EdgeKind, Graph, GraphEdge, GraphNode, NodeType } from './schema';

export interface Size {
  width: number;
  height: number;
}

/** Node box per type. The node components render at these sizes, so layout and drawing agree. */
export const NODE_SIZES: Readonly<Record<NodeType, Size>> = {
  bet: { width: 240, height: 84 },
  assumption: { width: 220, height: 84 },
  milestone: { width: 220, height: 72 },
  'fixed-point': { width: 240, height: 72 },
  'current-position': { width: 200, height: 56 },
};

/** Edge kinds hidden by default, and left out of the layout (plan Schema section). */
export const HIDDEN_EDGE_KINDS: readonly EdgeKind[] = ['ultimately-serves'];

/**
 * An edge as drawn and laid out: from the left-hand end to the right-hand one. A bet sits left of
 * what it serves and of its `next`; a prerequisite left of the bet that requires it; an assumption
 * left of the note that leans on it. So `requires` and `assumptions` are drawn against the field.
 */
export function flowOf(edge: Pick<GraphEdge, 'kind' | 'from' | 'to'>): { source: string; target: string } {
  return edge.kind === 'requires' || edge.kind === 'assumption'
    ? { source: edge.to, target: edge.from }
    : { source: edge.from, target: edge.to };
}

const GAP = 40;

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}

const elk = new ELK();

/** A string that changes exactly when ELK's input changes, to reuse a layout across position-only updates. */
export function layoutKey(graph: Graph): string {
  const nodes = graph.nodes.map((n) => `${n.key}:${n.type}`);
  const edges = graph.edges.filter((e) => !HIDDEN_EDGE_KINDS.includes(e.kind)).map((e) => e.key);
  return JSON.stringify([nodes, edges]);
}

/** ELK's layered layout of every node, ignoring saved positions. */
export async function elkPositions(graph: Graph): Promise<Record<string, GsPosition>> {
  if (!graph.nodes.length) return {};
  const children: ElkNode[] = graph.nodes.map((node) => {
    const constraint = node.type === 'current-position' ? 'FIRST_SEPARATE' : node.type === 'fixed-point' ? 'LAST_SEPARATE' : null;
    return {
      id: node.key,
      ...NODE_SIZES[node.type],
      ...(constraint ? { layoutOptions: { 'elk.layered.layering.layerConstraint': constraint } } : {}),
    };
  });
  const seen = new Set<string>();
  const edges = [];
  for (const edge of graph.edges) {
    if (HIDDEN_EDGE_KINDS.includes(edge.kind)) continue;
    const { source, target } = flowOf(edge);
    const id = `${source}>${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, sources: [source], targets: [target] });
  }
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      // One layering for everything, so the current position and fixed points get their own columns
      // even when nothing links them yet.
      'elk.separateConnectedComponents': 'false',
      'elk.spacing.nodeNode': String(GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children,
    edges,
  });
  const out: Record<string, GsPosition> = {};
  for (const child of (result.children ?? []) as ElkNode[]) out[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  return out;
}

/** Saved positions of the graph's nodes, by node key. A node whose id is missing or shared has none. */
export function pinnedPositions(graph: Graph, saved: Readonly<Record<string, GsPosition>>): Record<string, GsPosition> {
  const out: Record<string, GsPosition> = {};
  for (const node of graph.nodes) {
    if (canPin(node) && Object.prototype.hasOwnProperty.call(saved, node.key)) out[node.key] = saved[node.key];
  }
  return out;
}

/** Whether a node's position can be saved: it needs an id that no other note uses. */
export function canPin(node: Pick<GraphNode, 'id' | 'key'>): boolean {
  return node.id !== null && node.key === node.id;
}

interface Rect extends GsPosition, Size {}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width + GAP / 2 && b.x < a.x + a.width + GAP / 2 && a.y < b.y + b.height + GAP / 2 && b.y < a.y + a.height + GAP / 2;

/**
 * Final positions: pinned nodes exactly where they were saved; the others where ELK put them
 * relative to their nearest placed neighbours (a new bet lands left of the bet it serves, as
 * ELK would have it), or, for a group with no placed neighbour at all, as a block below the
 * pinned nodes. A placed node is pushed down until it overlaps nothing placed before it.
 * With nothing pinned, this is ELK's layout unchanged. Deterministic for the same input.
 */
export function placeNodes(
  graph: Graph,
  layered: Readonly<Record<string, GsPosition>>,
  pinned: Readonly<Record<string, GsPosition>>
): Record<string, GsPosition> {
  const keys = graph.nodes.map((n) => n.key);
  const pinnedKeys = keys.filter((k) => pinned[k]);
  if (!pinnedKeys.length) return Object.fromEntries(keys.map((k) => [k, layered[k] ?? { x: 0, y: 0 }]));

  const size = new Map(graph.nodes.map((n) => [n.key, NODE_SIZES[n.type]]));
  const at = (key: string): GsPosition => layered[key] ?? { x: 0, y: 0 };
  const result: Record<string, GsPosition> = {};
  const placed: Rect[] = [];
  for (const key of pinnedKeys) {
    result[key] = { ...pinned[key] };
    placed.push({ ...result[key], ...size.get(key)! });
  }

  const neighbours = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const edge of graph.edges) {
    if (HIDDEN_EDGE_KINDS.includes(edge.kind)) continue;
    neighbours.get(edge.from)?.push(edge.to);
    neighbours.get(edge.to)?.push(edge.from);
  }

  const settle = (key: string, position: GsPosition) => {
    const rect: Rect = { ...position, ...size.get(key)! };
    for (let guard = 0; guard < placed.length + 1; guard++) {
      const hit = placed.find((other) => overlaps(rect, other));
      if (!hit) break;
      rect.y = hit.y + hit.height + GAP;
    }
    result[key] = { x: rect.x, y: rect.y };
    placed.push(rect);
  };

  // ELK's reading order: column by column, top to bottom.
  let waiting = keys
    .filter((k) => !result[k])
    .sort((a, b) => at(a).x - at(b).x || at(a).y - at(b).y || (a < b ? -1 : a > b ? 1 : 0));

  for (let progress = true; progress && waiting.length; ) {
    progress = false;
    for (const key of waiting) {
      const anchors = neighbours.get(key)!.filter((n) => result[n]);
      if (!anchors.length) continue;
      const x = anchors.reduce((sum, a) => sum + result[a].x + at(key).x - at(a).x, 0) / anchors.length;
      const y = anchors.reduce((sum, a) => sum + result[a].y + at(key).y - at(a).y, 0) / anchors.length;
      settle(key, { x, y });
      progress = true;
    }
    waiting = waiting.filter((k) => !result[k]);
  }

  if (waiting.length) {
    // Nothing links these to a placed node: keep ELK's arrangement, below everything placed.
    const left = Math.min(...placed.map((r) => r.x));
    const bottom = Math.max(...placed.map((r) => r.y + r.height));
    const minX = Math.min(...waiting.map((k) => at(k).x));
    const minY = Math.min(...waiting.map((k) => at(k).y));
    for (const key of waiting) settle(key, { x: left + at(key).x - minX, y: bottom + 2 * GAP + at(key).y - minY });
  }
  return result;
}

/** Positions for every node of the graph: saved ones kept, the rest laid out. Runs ELK only when something is unsaved. */
export async function layoutGraph(graph: Graph, saved: Readonly<Record<string, GsPosition>>): Promise<Record<string, GsPosition>> {
  const pinned = pinnedPositions(graph, saved);
  const allPinned = graph.nodes.every((n) => pinned[n.key]);
  return placeNodes(graph, allPinned ? {} : await elkPositions(graph), pinned);
}
