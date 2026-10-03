/**
 * Where each node goes on the graph (plan Phase 5a, D19). Saved positions (`.gsmap`, by note id)
 * are kept exactly; this decides where everything else goes.
 *
 * Left to right is time: the current position, then bets and milestones along their `serves`
 * and `requires` chains, then the fixed points. ELK lays out that time axis. Bets that follow the
 * same bet share a column (they run in parallel).
 *
 * Assumptions are not on the time axis. Each one sits next to the note that hosts it: above it, or
 * below when there is no room above, or aside (to the right) when below is taken too. The host is
 * the holder that comes first in time (`structureOf`). A `next` sequel sits directly below the bet
 * it follows.
 *
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

/** Edges along the time axis. Assumption links are not: an assumption sits beside its host. */
const TIME_EDGE_KINDS: readonly EdgeKind[] = ['serves', 'requires', 'next'];

/**
 * An edge from its earlier end to its later one. A bet comes before what it serves and before its
 * `next`; a prerequisite before the bet that requires it; an assumption is drawn from itself to the
 * note that leans on it. So `requires` and `assumptions` run against the field.
 */
export function flowOf(edge: Pick<GraphEdge, 'kind' | 'from' | 'to'>): { source: string; target: string } {
  return edge.kind === 'requires' || edge.kind === 'assumption'
    ? { source: edge.to, target: edge.from }
    : { source: edge.from, target: edge.to };
}

const GAP = 40;
/** Between an assumption and its host, or the assumption next to it. */
const SATELLITE_GAP = 24;

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------ structure

export interface LayoutStructure {
  /** Nodes on the time axis: everything but hosted assumptions (an assumption nothing leans on stays here). */
  time: string[];
  /** Column order along the time axis, from the edges alone (longest path from the left). */
  rank: Map<string, number>;
  /** Hosted assumption → its host: the holder that comes first in time (lowest rank, then key). */
  hostOf: Map<string, string>;
  /** Host → its hosted assumptions, by key. */
  satellites: Map<string, string[]>;
  /** Sequel → the bet it sits under (`next`). */
  predecessorOf: Map<string, string>;
  /** Root → the column it heads: itself, then its sequel chain, top to bottom. */
  spines: Map<string, string[]>;
  /** Time edges in flow direction, between time nodes, deduplicated. */
  timeEdges: [string, string][];
}

/** How the graph decomposes for layout. Depends on the notes and links only, never on positions. */
export function structureOf(graph: Graph): LayoutStructure {
  const keys = graph.nodes.map((n) => n.key);
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));

  const flow: [string, string][] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!TIME_EDGE_KINDS.includes(edge.kind)) continue;
    const { source, target } = flowOf(edge);
    const id = `${source}>${target}`;
    if (!seen.has(id)) {
      seen.add(id);
      flow.push([source, target]);
    }
  }

  // Longest path from the left over the time edges; an edge closing a cycle is ignored.
  const incoming = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const [s, t] of flow) incoming.get(t)!.push(s);
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (key: string): number => {
    const known = rank.get(key);
    if (known !== undefined) return known;
    visiting.add(key);
    let r = 0;
    for (const s of incoming.get(key)!) if (!visiting.has(s)) r = Math.max(r, rankOf(s) + 1);
    visiting.delete(key);
    rank.set(key, r);
    return r;
  };
  keys.forEach(rankOf);
  const earlier = (a: string, b: string) => rank.get(a)! - rank.get(b)! || byKey(a, b);

  const hostOf = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'assumption') continue;
    const current = hostOf.get(edge.to);
    if (current === undefined || earlier(edge.from, current) < 0) hostOf.set(edge.to, edge.from);
  }
  const satellites = new Map<string, string[]>();
  for (const [assumption, host] of Array.from(hostOf).sort((a, b) => byKey(a[0], b[0]))) {
    satellites.set(host, [...(satellites.get(host) ?? []), assumption]);
  }

  // Sequels: under the earliest bet naming them as `next`, unless that would loop.
  const predecessorOf = new Map<string, string>();
  const nextEdges = graph.edges.filter((e) => e.kind === 'next' && typeOf.get(e.from) === 'bet' && typeOf.get(e.to) === 'bet');
  for (const edge of nextEdges.sort((a, b) => earlier(a.from, b.from))) {
    if (predecessorOf.has(edge.to)) continue;
    let up: string | undefined = edge.from;
    while (up !== undefined && up !== edge.to) up = predecessorOf.get(up);
    if (up === edge.to) continue;
    predecessorOf.set(edge.to, edge.from);
  }
  const sequelOf = new Map<string, string>();
  for (const [sequel, pred] of Array.from(predecessorOf).sort((a, b) => byKey(a[0], b[0]))) {
    if (!sequelOf.has(pred)) sequelOf.set(pred, sequel);
    else predecessorOf.delete(sequel); // a bet holds one sequel below it; any other stays on its own
  }

  const time = keys.filter((k) => !hostOf.has(k));
  const spines = new Map<string, string[]>();
  for (const key of time) {
    if (predecessorOf.has(key)) continue;
    const spine = [key];
    for (let s = sequelOf.get(key); s !== undefined; s = sequelOf.get(s)) spine.push(s);
    spines.set(key, spine);
  }
  const timeSet = new Set(time);
  return {
    time,
    rank,
    hostOf,
    satellites,
    predecessorOf,
    spines,
    timeEdges: flow.filter(([s, t]) => timeSet.has(s) && timeSet.has(t)),
  };
}

// ------------------------------------------------------------------ placing next to a host

interface Rect extends GsPosition, Size {}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width + GAP / 2 && b.x < a.x + a.width + GAP / 2 && a.y < b.y + b.height + GAP / 2 && b.y < a.y + a.height + GAP / 2;

class Occupancy {
  readonly rects: Rect[] = [];

  hit(rect: Rect): Rect | undefined {
    return this.rects.find((other) => overlaps(rect, other));
  }

  add(rect: Rect): void {
    this.rects.push(rect);
  }

  /** Move `rect` down until it overlaps nothing, then take the spot. */
  settle(rect: Rect): Rect {
    const out = { ...rect };
    for (let guard = 0; guard <= this.rects.length; guard++) {
      const hit = this.hit(out);
      if (!hit) break;
      out.y = hit.y + hit.height + GAP;
    }
    this.add(out);
    return out;
  }
}

/**
 * Put a host's assumptions next to it, in order: stacked upward above it; where the next spot
 * above is taken, below it instead; where that is taken too (a sequel), aside to its right.
 */
function placeSatellites(host: Rect, satellites: { key: string; size: Size }[], space: Occupancy, out: Record<string, GsPosition>) {
  let top = host.y;
  let bottom = host.y + host.height;
  let aside = host.y + host.height + SATELLITE_GAP;
  for (const { key, size } of satellites) {
    const x = host.x + (host.width - size.width) / 2;
    const above: Rect = { x, y: top - SATELLITE_GAP - size.height, ...size };
    const below: Rect = { x, y: bottom + SATELLITE_GAP, ...size };
    let rect: Rect;
    if (!space.hit(above)) {
      rect = above;
      top = rect.y;
      space.add(rect);
    } else if (!space.hit(below)) {
      rect = below;
      bottom = rect.y + rect.height;
      space.add(rect);
    } else {
      rect = space.settle({ x: host.x + host.width + GAP, y: aside, ...size });
      aside = rect.y + rect.height + SATELLITE_GAP;
    }
    out[key] = { x: rect.x, y: rect.y };
  }
}

// ------------------------------------------------------------------ ELK on the time axis

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

/**
 * A column block in its own coordinates: the root at the top, its sequels below it, and every
 * member's assumptions placed as `placeSatellites` would. Offsets are from the block's top-left.
 */
function blockOf(spine: string[], s: LayoutStructure, size: (key: string) => Size) {
  const space = new Occupancy();
  const local: Record<string, GsPosition> = {};
  let y = 0;
  for (const key of spine) {
    const rect = { x: 0, y, ...size(key) };
    space.add(rect);
    local[key] = { x: 0, y };
    y += rect.height + GAP;
  }
  for (const key of spine) {
    const sats = (s.satellites.get(key) ?? []).map((k) => ({ key: k, size: size(k) }));
    placeSatellites({ ...local[key], ...size(key) }, sats, space, local);
  }
  const minX = Math.min(...space.rects.map((r) => r.x));
  const minY = Math.min(...space.rects.map((r) => r.y));
  const width = Math.max(...space.rects.map((r) => r.x + r.width)) - minX;
  const height = Math.max(...space.rects.map((r) => r.y + r.height)) - minY;
  const offsets = Object.fromEntries(spine.map((k) => [k, { x: local[k].x - minX, y: local[k].y - minY }]));
  return { width, height, offsets };
}

/**
 * ELK's layered layout of the time axis, ignoring saved positions: a position for every node on
 * it (assumptions are placed later, next to their host). Each column block (a bet, its sequels and
 * the room their assumptions need) is one ELK node, so neighbouring blocks never collide.
 */
export async function elkPositions(graph: Graph): Promise<Record<string, GsPosition>> {
  if (!graph.nodes.length) return {};
  const s = structureOf(graph);
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));
  const size = (key: string) => NODE_SIZES[typeOf.get(key)!];
  const rootOf = new Map<string, string>();
  const blocks = new Map<string, ReturnType<typeof blockOf>>();
  for (const [root, spine] of s.spines) {
    spine.forEach((k) => rootOf.set(k, root));
    blocks.set(root, blockOf(spine, s, size));
  }

  const children: ElkNode[] = Array.from(blocks, ([root, block]) => {
    const type = typeOf.get(root);
    const constraint = type === 'current-position' ? 'FIRST_SEPARATE' : type === 'fixed-point' ? 'LAST_SEPARATE' : null;
    return {
      id: root,
      width: block.width,
      height: block.height,
      ...(constraint ? { layoutOptions: { 'elk.layered.layering.layerConstraint': constraint } } : {}),
    };
  });
  const seen = new Set<string>();
  const edges = [];
  for (const [source, target] of s.timeEdges) {
    const [a, b] = [rootOf.get(source)!, rootOf.get(target)!];
    const id = `${a}>${b}`;
    if (a === b || seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, sources: [a], targets: [b] });
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
  for (const child of (result.children ?? []) as ElkNode[]) {
    const block = blocks.get(child.id)!;
    for (const [key, offset] of Object.entries(block.offsets)) {
      out[key] = { x: (child.x ?? 0) + offset.x, y: (child.y ?? 0) + offset.y };
    }
  }
  return out;
}

// ------------------------------------------------------------------ final positions

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

/** Whether ELK is needed: some node on the time axis has no saved position. Assumptions never need it. */
export function needsElk(graph: Graph, pinned: Readonly<Record<string, GsPosition>>): boolean {
  return structureOf(graph).time.some((k) => !pinned[k]);
}

/**
 * Final positions.
 * 1. Saved nodes exactly where they were saved.
 * 2. Other nodes on the time axis: a sequel directly below its bet; anything else where ELK put
 *    it relative to its placed neighbours along the time axis (a new bet lands left of the bet it
 *    serves); a group with no placed neighbour, as a block below the saved nodes. Pushed down
 *    until it overlaps nothing.
 * 3. Unsaved assumptions next to their host, above it when there is room (`placeSatellites`).
 * A node on the time axis with neither a saved nor an ELK position (ELK still running) is left
 * out, and so are its assumptions. Deterministic for the same input.
 */
export function placeNodes(
  graph: Graph,
  layered: Readonly<Record<string, GsPosition>>,
  pinned: Readonly<Record<string, GsPosition>>
): Record<string, GsPosition> {
  const s = structureOf(graph);
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]));
  const size = (key: string) => NODE_SIZES[typeOf.get(key)!];
  const result: Record<string, GsPosition> = {};
  const space = new Occupancy();
  const keys = graph.nodes.map((n) => n.key);
  for (const key of keys) {
    if (!pinned[key]) continue;
    result[key] = { ...pinned[key] };
    space.add({ ...result[key], ...size(key) });
  }
  const anyPinned = Object.keys(result).length > 0;
  const at = (key: string): GsPosition => layered[key];
  const place = (key: string, position: GsPosition) => {
    const rect = space.settle({ ...position, ...size(key) });
    result[key] = { x: rect.x, y: rect.y };
  };

  // 2. The time axis.
  let waiting = s.time
    .filter((k) => !result[k] && layered[k])
    .sort((a, b) => at(a).x - at(b).x || at(a).y - at(b).y || byKey(a, b));
  if (!anyPinned) {
    for (const key of waiting) {
      result[key] = { ...at(key) };
      space.add({ ...result[key], ...size(key) });
    }
    waiting = [];
  }
  const neighbours = new Map<string, string[]>(s.time.map((k) => [k, []]));
  for (const [a, b] of s.timeEdges) {
    neighbours.get(a)!.push(b);
    neighbours.get(b)!.push(a);
  }
  for (let progress = true; progress && waiting.length; ) {
    progress = false;
    for (const key of waiting) {
      const pred = s.predecessorOf.get(key);
      if (pred !== undefined && result[pred]) {
        place(key, { x: result[pred].x, y: result[pred].y + size(pred).height + GAP });
        progress = true;
        continue;
      }
      const anchors = neighbours.get(key)!.filter((n) => result[n] && layered[n]);
      if (!anchors.length) continue;
      const x = anchors.reduce((sum, a) => sum + result[a].x + at(key).x - at(a).x, 0) / anchors.length;
      const y = anchors.reduce((sum, a) => sum + result[a].y + at(key).y - at(a).y, 0) / anchors.length;
      place(key, { x, y });
      progress = true;
    }
    waiting = waiting.filter((k) => !result[k]);
  }
  if (waiting.length) {
    // Nothing links these to a placed node: keep ELK's arrangement, below everything placed.
    const left = Math.min(...space.rects.map((r) => r.x));
    const bottom = Math.max(...space.rects.map((r) => r.y + r.height));
    const minX = Math.min(...waiting.map((k) => at(k).x));
    const minY = Math.min(...waiting.map((k) => at(k).y));
    for (const key of waiting) place(key, { x: left + at(key).x - minX, y: bottom + 2 * GAP + at(key).y - minY });
  }

  // 3. Assumptions, host by host along the time axis.
  const hosts = Array.from(s.satellites.keys())
    .filter((h) => result[h])
    .sort((a, b) => result[a].x - result[b].x || result[a].y - result[b].y || byKey(a, b));
  for (const host of hosts) {
    const sats = s.satellites.get(host)!.filter((k) => !result[k]).map((k) => ({ key: k, size: size(k) }));
    placeSatellites({ ...result[host], ...size(host) }, sats, space, result);
  }
  return result;
}

/** Positions for every node of the graph: saved ones kept, the rest laid out. Runs ELK only when the time axis has unsaved nodes. */
export async function layoutGraph(graph: Graph, saved: Readonly<Record<string, GsPosition>>): Promise<Record<string, GsPosition>> {
  const pinned = pinnedPositions(graph, saved);
  return placeNodes(graph, needsElk(graph, pinned) ? await elkPositions(graph) : {}, pinned);
}
