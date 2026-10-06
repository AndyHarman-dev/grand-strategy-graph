/**
 * The review walk (plan Phase 8, replacing the canvas's presentation mode): a strategy is reviewed
 * the way it was broken down, from the goal backwards. Each fixed point in turn, then each route that
 * leads to it, walked to its end before the next one starts: the fixed point, the notes that serve it
 * (or that it requires), the notes that serve those, and so on back to the current position. Those
 * chains are the strategy's routes (D16); a milestone is on them like a bet (D17).
 *
 * The order is fixed, so a review always goes the same way: fixed points by id, and at every fork the
 * branches by id. Every note is walked once: a note on two routes (or under two fixed points) is walked
 * on the first, and the second route stops where it meets it, naming it in `joins`. A route that
 * starts from nothing earlier ends on the current position, when the vault has one. Bets and
 * milestones on no route are not walked (the smells panel lists them), nor are assumptions: they are
 * reviewed with the note that leans on them.
 */
import type { Graph, GraphNode } from './schema';

export type WalkGroup = 'fixed-point' | 'route' | 'current-position';

export interface WalkStep {
  /** Unique in a walk (a note on two routes has a step on each): the chain in `via`. The walk follows it across edits. */
  id: string;
  /** Key of the note this step is about. */
  node: string;
  group: WalkGroup;
  /** The fixed point this step's route leads to (itself for a fixed point). */
  fixedPoint: string;
  /** Steps back from the fixed point: 0 for the fixed point, 1 for a note that serves it directly. */
  depth: number;
  /** The chain from this note up to its fixed point, this note first (just itself for a fixed point). */
  via: string[];
  /** Keys of the assumptions this note leans on, in graph order: reviewed with it. */
  assumptions: string[];
  /** Keys of the notes one step back from this one that were walked earlier, by id: the walk doesn't go through them again. */
  joins: string[];
  /** Which of the fixed point's routes this step is on, from 1 (0 on the fixed point's own step). */
  route: number;
  /** How many routes lead to the fixed point. */
  routes: number;
  /** How many steps the route has after its fixed point, the current position included: `depth` counts up to it. */
  routeLength: number;
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
const onRoute = (node: GraphNode | undefined): node is GraphNode => !!node && (node.type === 'bet' || node.type === 'milestone');

export function reviewWalk(graph: Graph): WalkStep[] {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const assumptionsOf = new Map<string, string[]>();
  // One step back in time from a note: what serves it, and what it requires (read backwards, so a
  // prerequisite whose `serves` side is missing is still on the route).
  const before = new Map<string, Set<string>>();
  const link = (later: string, earlier: string) => before.set(later, (before.get(later) ?? new Set()).add(earlier));
  for (const edge of graph.edges) {
    if (edge.kind === 'assumption') assumptionsOf.set(edge.from, [...(assumptionsOf.get(edge.from) ?? []), edge.to]);
    if (edge.kind === 'serves') link(edge.to, edge.from);
    if (edge.kind === 'requires') link(edge.from, edge.to);
  }
  const current = graph.nodes.filter((n) => n.type === 'current-position').sort(byLabel)[0] ?? null;

  const steps: WalkStep[] = [];
  const walked = new Set<string>();
  for (const fixed of graph.nodes.filter((n) => n.type === 'fixed-point').sort(byLabel)) {
    const ownSteps: WalkStep[] = [];
    const lengths: number[] = []; // by route, from 0
    const step = (node: GraphNode, group: WalkGroup, depth: number, via: string[]) => {
      if (group !== 'current-position') walked.add(node.key);
      const made: WalkStep = {
        id: via.join('\n'),
        node: node.key,
        group,
        fixedPoint: fixed.key,
        depth,
        via,
        assumptions: assumptionsOf.get(node.key) ?? [],
        joins: [],
        route: group === 'fixed-point' ? 0 : lengths.length + 1,
        routes: 0,
        routeLength: 0,
      };
      ownSteps.push(made);
      return made;
    };
    // Depth first: each branch to its end before the next, skipping what was walked already.
    const walk = (made: WalkStep, depth: number) => {
      const earlier = [...(before.get(made.node) ?? [])]
        .map((key) => nodes.get(key))
        .filter(onRoute)
        .filter((n) => !made.via.includes(n.key)) // a serves loop closes here
        .sort(byLabel);
      let went = false;
      for (const n of earlier) {
        // Checked as the loop goes: an earlier branch may have walked it.
        if (walked.has(n.key)) {
          made.joins.push(n.key);
          continue;
        }
        went = true;
        walk(step(n, 'route', depth + 1, [n.key, ...made.via]), depth + 1);
      }
      if (depth === 0 || went) return;
      // A route ends here. It starts from now only when nothing comes before it; else it joins one walked already.
      const fromNow = !earlier.length && current;
      if (fromNow) step(current, 'current-position', depth + 1, [current.key, ...made.via]);
      lengths.push(depth + (fromNow ? 1 : 0));
    };
    walk(step(fixed, 'fixed-point', 0, [fixed.key]), 0);
    for (const s of ownSteps) {
      s.routes = lengths.length;
      s.routeLength = s.route ? lengths[s.route - 1] : 0;
    }
    steps.push(...ownSteps);
  }
  return steps;
}
