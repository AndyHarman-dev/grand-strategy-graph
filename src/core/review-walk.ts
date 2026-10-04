/**
 * The review walk (plan Phase 8, replacing the canvas's presentation mode): every fixed point in
 * turn, then the notes that lead to it, outward along the `serves` chains (those chains are the
 * strategy's routes, D16), nearest first. The order is fixed, so a review always goes the same way:
 * fixed points by id, then each one's routes by distance and id; a note two fixed points share is
 * visited under the first. Bets and milestones that no chain leads anywhere come last.
 */
import type { Graph, GraphNode } from './schema';

export type WalkGroup = 'fixed-point' | 'route' | 'unrouted';

export interface WalkStep {
  /** Key of the note this step is about. */
  node: string;
  group: WalkGroup;
  /** The fixed point this route was reached from; null for a fixed point itself and for unrouted notes. */
  fixedPoint: string | null;
  /** Steps out from the fixed point: 0 for the fixed point, 1 for a note that serves it directly. */
  depth: number;
  /** The chain from this note up to its fixed point, this note first (just itself for a fixed point or an unrouted note). */
  via: string[];
  /** Keys of the assumptions this note leans on, in graph order: reviewed with it. */
  assumptions: string[];
}

/** `B-2` before `B-10`: numbers inside names compare as numbers. */
export function naturalCompare(a: string, b: string): number {
  const parts = (text: string) => text.match(/\d+|\D+/g) ?? [];
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const [x, y] = [pa[i], pb[i]];
    const numeric = /^\d/.test(x) && /^\d/.test(y);
    const diff = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (diff) return diff;
  }
  return pa.length - pb.length;
}

const labelOf = (node: GraphNode) => node.id ?? node.basename;
const byLabel = (a: GraphNode, b: GraphNode) => naturalCompare(labelOf(a), labelOf(b)) || naturalCompare(a.key, b.key);

export function reviewWalk(graph: Graph): WalkStep[] {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const assumptionsOf = new Map<string, string[]>();
  const servers = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'assumption') assumptionsOf.set(edge.from, [...(assumptionsOf.get(edge.from) ?? []), edge.to]);
    if (edge.kind === 'serves') servers.set(edge.to, [...(servers.get(edge.to) ?? []), edge.from]);
  }
  const steps: WalkStep[] = [];
  const visited = new Set<string>();
  const step = (node: GraphNode, group: WalkGroup, fixedPoint: string | null, depth: number, via: string[]) => {
    visited.add(node.key);
    steps.push({ node: node.key, group, fixedPoint, depth, via, assumptions: assumptionsOf.get(node.key) ?? [] });
  };

  for (const fixed of graph.nodes.filter((n) => n.type === 'fixed-point').sort(byLabel)) {
    if (visited.has(fixed.key)) continue;
    step(fixed, 'fixed-point', null, 0, [fixed.key]);
    // Outward, level by level; a note takes the first parent (in walk order) that reaches it.
    let frontier = [{ node: fixed, via: [fixed.key] }];
    for (let depth = 1; frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const { node, via } of frontier) {
        const found = (servers.get(node.key) ?? [])
          .map((key) => nodes.get(key))
          .filter((n): n is GraphNode => !!n && (n.type === 'bet' || n.type === 'milestone') && !visited.has(n.key))
          .sort(byLabel);
        for (const server of found) {
          if (visited.has(server.key)) continue;
          visited.add(server.key);
          next.push({ node: server, via: [server.key, ...via] });
        }
      }
      next.sort((a, b) => byLabel(a.node, b.node));
      for (const { node, via } of next) step(node, 'route', fixed.key, depth, via);
      frontier = next;
    }
  }

  for (const node of graph.nodes.filter((n) => (n.type === 'bet' || n.type === 'milestone') && !visited.has(n.key)).sort(byLabel)) {
    step(node, 'unrouted', null, 0, [node.key]);
  }
  return steps;
}
