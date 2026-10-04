/**
 * Parity gate (plan Phase 2, must pass before Phase 3). Runs Phase 1's `buildGraph` over
 * the *planned* vault and checks the plan against the oracle from the outside: it never
 * trusts the planner's own bookkeeping where it can re-derive the answer.
 */
import { parseFrontmatter } from '../../src/core/frontmatter';
import { buildGraph } from '../../src/core/graph';
import { MemoryAdapter, STRATEGY_ROOT } from '../../src/core/memory-adapter';
import type { EdgeKind, Graph } from '../../src/core/schema';
import { sameHeading, sections, splitNote } from './markdown';
import { dependedOnByBlock } from '../../src/core/content';
import { applyPlan, BET_ASSUMPTIONS_HEADING, DEPENDED_ON_BY_HEADING, SERVES_HEADING } from './plan';
import type { MigrationOptions, MigrationPlan, RelField } from './types';

export interface GateCheck {
  name: string;
  title: string;
  passed: boolean;
  failures: string[];
}

export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
  /** The planned vault's graph, for the report. */
  graph: Graph;
}

/** Frontmatter keys the migration may change; every other key must survive unchanged. */
const MANAGED_KEYS = new Set(['id', 'type', 'status', 'serves', 'ultimately-serves', 'requires', 'next', 'next sequel', 'assumptions']);
const MANAGED_HEADINGS = [SERVES_HEADING, BET_ASSUMPTIONS_HEADING, DEPENDED_ON_BY_HEADING];

const kindOf = (field: RelField): EdgeKind => (field === 'assumptions' ? 'assumption' : field);

/** The body minus every managed `##` section, line by line. */
function prose(body: string): string {
  const lines = body.split('\n');
  const kept: string[] = [];
  for (const s of sections(lines)) {
    if (s.level === 2 && MANAGED_HEADINGS.some((h) => sameHeading(s.heading, h))) continue;
    kept.push(...lines.slice(s.start, s.end));
  }
  return kept.join('\n');
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function parityGate(files: Readonly<Record<string, string>>, plan: MigrationPlan, options: MigrationOptions = {}): Promise<GateResult> {
  const root = (options.strategyRoot ?? STRATEGY_ROOT).replace(/\/+$/, '');
  const planned = applyPlan(files, plan);
  const graph = buildGraph(await new MemoryAdapter(planned, { root }).readNotes());
  const keyOf = new Map(graph.nodes.map((n) => [n.path, n.key]));
  const graphEdges = new Set(graph.edges.map((e) => `${e.kind}|${e.from}|${e.to}`));
  const name = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const checks: GateCheck[] = [];
  const check = (name: string, title: string, failures: string[]) => checks.push({ name, title, passed: !failures.length, failures });

  check(
    'no-blockers',
    'Nothing the planner had to refuse (unreadable frontmatter, unknown canvas nodes)',
    plan.findings.filter((f) => f.severity === 'blocker').map((f) => `${f.path ? f.path + ': ' : ''}${f.message}`)
  );

  check(
    'zero-unaccounted',
    'Zero unaccounted edges: every oracle edge has a classified fate',
    plan.edges.filter((e) => e.fate.kind === 'unclassified').map((e) => `${e.edge.id}: ${e.fate.kind === 'unclassified' ? e.fate.reason : ''}`)
  );

  check(
    'no-open-ambiguities',
    'Every ambiguity has an accepted answer in resolutions.yaml',
    plan.ambiguities.filter((a) => !a.resolved).map((a) => `${a.key}${a.error ? ` (answer rejected: ${a.error})` : ''}`)
  );

  // Every written fate must be an edge of the planned graph…
  const expected = new Set<string>();
  const missing: string[] = [];
  const expect = (field: RelField, holder: string, target: string, why: string) => {
    const from = keyOf.get(holder);
    const to = keyOf.get(target);
    const key = `${kindOf(field)}|${from}|${to}`;
    expected.add(key);
    if (!from || !to || !graphEdges.has(key)) missing.push(`${why}: \`${field}\` ${name(holder)} → ${name(target)} is not in the planned graph`);
  };
  for (const { edge, fate } of plan.edges) if (fate.kind === 'written') expect(fate.field, fate.holder, fate.target, edge.id);
  for (const d of plan.derived) expect(d.field, d.holder, d.target, d.why);
  check('relations-present', 'Every edge classified as a relation is present in the planned graph', missing);

  // …and every edge of the planned graph must come from the oracle (nothing invented).
  check(
    'nothing-invented',
    'Every relation in the planned graph is backed by an oracle edge or a resolution',
    graph.edges.filter((e) => !expected.has(`${e.kind}|${e.from}|${e.to}`)).map((e) => `${e.field} ${e.from} → ${e.to}`)
  );

  // Only the managed frontmatter keys and the three sections may change.
  const proseFailures: string[] = [];
  for (const change of plan.changes) {
    if (!change.path.endsWith('.md') || change.before === null) continue;
    const before = splitNote(change.before);
    const after = splitNote(change.after);
    if (prose(before.body) !== prose(after.body)) proseFailures.push(`${change.path}: body changed outside the managed sections`);
    const block = dependedOnByBlock(root).join('\n');
    const lines = after.body.split('\n');
    for (const s of sections(lines)) {
      if (s.level !== 2 || !MANAGED_HEADINGS.some((h) => sameHeading(s.heading, h))) continue;
      const content = lines.slice(s.start, s.end).join('\n');
      const isBlock = lines.slice(s.start + 1, s.end).map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).join('\n') === block;
      if (!isBlock && !change.before.includes(content)) proseFailures.push(`${change.path}: \`## ${s.heading}\` was rewritten into something other than the Dataview block`);
    }
    const fmBefore = parseFrontmatter(change.before).frontmatter;
    const fmAfter = parseFrontmatter(change.after).frontmatter;
    const unmanaged = (fm: Record<string, unknown>) => Object.keys(fm).filter((k) => !MANAGED_KEYS.has(k));
    if (!deepEqual(unmanaged(fmBefore), unmanaged(fmAfter))) proseFailures.push(`${change.path}: unmanaged frontmatter keys or their order changed`);
    for (const k of unmanaged(fmBefore)) {
      if (!deepEqual(fmBefore[k], fmAfter[k])) proseFailures.push(`${change.path}: frontmatter \`${k}\` changed`);
    }
  }
  check('prose-unchanged', 'Prose outside the three sections and unmanaged frontmatter are unchanged', proseFailures);

  const gsmap = plan.gsmap;
  const cardIds = new Set(gsmap.cards.map((c) => c.id));
  const frameIds = new Set(gsmap.frames.map((f) => f.id));
  const nodeKeys = new Set(graph.nodes.map((n) => n.key));
  check(
    'canvas-placed',
    'Every canvas node has a position, card or frame',
    plan.canvasNodes.flatMap(({ node, placed }) => {
      if (!placed) return [`canvas node ${node} has nowhere to go`];
      const [kind, id] = [placed.slice(0, placed.indexOf(':')), placed.slice(placed.indexOf(':') + 1)];
      if (kind === 'position') return id in gsmap.positions && nodeKeys.has(id) ? [] : [`canvas node ${node}: position ${id} is not a node of the planned graph`];
      if (kind === 'card') return cardIds.has(id) ? [] : [`canvas node ${node}: card ${id} missing`];
      if (kind === 'junction') {
        // An "AND" card the graph draws itself: every `requires` it stands for must be in the planned graph.
        const junction = plan.junctions.find((j) => j.card === id);
        if (!junction) return [`canvas node ${node}: no "AND" junction ${id} in the plan`];
        return junction.requires
          .filter((r) => !graphEdges.has(`requires|${keyOf.get(r.holder)}|${keyOf.get(r.target)}`))
          .map((r) => `canvas node ${node}: "AND" ${name(r.holder)} requires ${name(r.target)} is not in the planned graph`);
      }
      return frameIds.has(id) ? [] : [`canvas node ${node}: frame ${id} missing`];
    })
  );

  const linkIds = new Set(gsmap.links.map((l) => l.id));
  const endpointOk = (e: { card: string } | { note: string }) => ('card' in e ? cardIds.has(e.card) : nodeKeys.has(e.note));
  check('gsmap-links', 'Every edge kept as a .gsmap link is there, and its ends exist', [
    ...plan.edges.filter((e) => e.fate.kind === 'gsmap-link' && !linkIds.has(e.fate.link)).map((e) => `${e.edge.id}: link missing from the .gsmap`),
    ...gsmap.links.filter((l) => !endpointOk(l.from) || !endpointOk(l.to)).map((l) => `link ${l.id} points at a card or note that doesn't exist`),
  ]);

  return { passed: checks.every((c) => c.passed), checks, graph };
}
