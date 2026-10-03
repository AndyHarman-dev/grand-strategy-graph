import type { Graph, GraphNode } from './schema';

export type SmellCode =
  | 'orphan-bet'
  | 'unreached-fixed-point'
  | 'gating-violation'
  | 'falsified-dependency'
  | 'overdue-bet'
  | 'dormant-not-next'
  | 'requires-open-milestone';

export interface Smell {
  code: SmellCode;
  /** Key of the node the smell is on. */
  node: string;
  message: string;
  /** Keys of the nodes that cause it (assumptions for the two assumption smells, milestones for `requires-open-milestone`). */
  related: string[];
}

export interface SmellOptions {
  /** Today as `YYYY-MM-DD`. Injected so the core never reads the clock. */
  today: string;
}

const datePart = (value: string) => value.slice(0, 10);

/**
 * Review-time warnings over a built graph (Phase 1 list):
 * - `orphan-bet`: no `serves` chain from the bet reaches a fixed point
 *   (`ultimately-serves` alone does not count; it is a hint, not a chain)
 * - `unreached-fixed-point`: nothing serves the fixed point
 * - `gating-violation`: an active bet leans on an unverified assumption with no `verify-by`
 * - `falsified-dependency`: an active bet leans on a falsified assumption
 * - `overdue-bet`: an active bet's deadline is before today
 * - `dormant-not-next`: a dormant bet that no bet names as its `next`
 * - `requires-open-milestone`: an active bet requires a milestone still `open` (D17): it started
 *   from a checkpoint that was not reached
 *
 * "Active" means status `active` exactly. Output order: by node key, then code.
 */
export function findSmells(graph: Graph, { today }: SmellOptions): Smell[] {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const serves = new Map<string, string[]>();
  const assumptions = new Map<string, string[]>();
  const requires = new Map<string, string[]>();
  const sequels = new Set<string>();
  const served = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === 'serves') {
      served.add(edge.to);
      serves.set(edge.from, [...(serves.get(edge.from) ?? []), edge.to]);
    } else if (edge.kind === 'assumption') {
      assumptions.set(edge.from, [...(assumptions.get(edge.from) ?? []), edge.to]);
    } else if (edge.kind === 'requires') {
      requires.set(edge.from, [...(requires.get(edge.from) ?? []), edge.to]);
    } else if (edge.kind === 'next') sequels.add(edge.to);
  }

  const reachesFixedPoint = (start: string): boolean => {
    const seen = new Set<string>([start]);
    const queue = [start];
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      for (const parent of serves.get(key) ?? []) {
        if (nodes.get(parent)?.type === 'fixed-point') return true;
        if (!seen.has(parent)) {
          seen.add(parent);
          queue.push(parent);
        }
      }
    }
    return false;
  };

  const out: Smell[] = [];
  const add = (code: SmellCode, node: GraphNode, message: string, related: string[] = []) =>
    out.push({ code, node: node.key, message, related });
  const label = (n: GraphNode) => n.basename;

  for (const node of graph.nodes) {
    if (node.type === 'fixed-point' && !served.has(node.key)) {
      add('unreached-fixed-point', node, `Nothing serves ${label(node)}.`);
    }
    if (node.type !== 'bet') continue;

    if (!reachesFixedPoint(node.key)) add('orphan-bet', node, `${label(node)} has no serves chain to a fixed point.`);
    if (node.status === 'dormant' && !sequels.has(node.key)) {
      add('dormant-not-next', node, `${label(node)} is dormant but is no bet's next.`);
    }
    if (node.status !== 'active') continue;

    if (node.deadline !== null && /^\d{4}-\d{2}-\d{2}/.test(node.deadline) && datePart(node.deadline) < today) {
      add('overdue-bet', node, `${label(node)} passed its deadline (${datePart(node.deadline)}) while active.`);
    }
    const deps = (assumptions.get(node.key) ?? []).map((k) => nodes.get(k)).filter((n): n is GraphNode => !!n);
    const ungated = deps.filter((a) => a.status === 'unverified' && a.verifyBy === null);
    if (ungated.length) {
      add('gating-violation', node, `${label(node)} is active on unverified assumptions with no verify-by: ${ungated.map(label).join(', ')}.`, ungated.map((a) => a.key));
    }
    const falsified = deps.filter((a) => a.status === 'falsified');
    if (falsified.length) {
      add('falsified-dependency', node, `${label(node)} is active but depends on falsified assumptions: ${falsified.map(label).join(', ')}.`, falsified.map((a) => a.key));
    }
    const openMilestones = (requires.get(node.key) ?? [])
      .map((k) => nodes.get(k))
      .filter((n): n is GraphNode => !!n && n.type === 'milestone' && n.status === 'open');
    if (openMilestones.length) {
      add('requires-open-milestone', node, `${label(node)} is active but requires milestones not reached yet: ${openMilestones.map(label).join(', ')}.`, openMilestones.map((m) => m.key));
    }
  }

  return out.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
