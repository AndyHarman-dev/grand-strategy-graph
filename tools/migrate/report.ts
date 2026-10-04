/**
 * Dry-run outputs: `migration-report.md`, the `resolutions.yaml` skeleton (carrying over
 * answers already given), and reading that file back. These contain real strategy
 * content when run on the real vault, so they are gitignored and never committed.
 */
import { parse, stringify } from 'yaml';
import type { GateResult } from './parity';
import type { ClassifiedEdge, Fate, MigrationPlan } from './types';

export const RESOLUTIONS_VERSION = 1;

export interface ReportMeta {
  vault: string;
  generatedAt: string;
  resolutionsFile: string | null;
}

export type Verdict = 'stop' | 'open' | 'gate-failed' | 'passed';

/** stop: a new decision is needed · open: answers needed · gate-failed: a planner bug · passed: ready for Phase 3. */
export function verdictOf(gate: GateResult): Verdict {
  const failed = (name: string) => gate.checks.some((c) => c.name === name && !c.passed);
  if (failed('no-blockers') || failed('zero-unaccounted')) return 'stop';
  if (failed('no-open-ambiguities') && gate.checks.filter((c) => !c.passed).every((c) => c.name === 'no-open-ambiguities')) return 'open';
  return gate.passed ? 'passed' : 'gate-failed';
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (path: string) => (path.startsWith('card:') || path.startsWith('group:') ? path : path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''));
const code = (text: string) => '`' + text.replace(/`/g, "'") + '`';

function fateText(fate: Fate): [string, string] {
  switch (fate.kind) {
    case 'written':
      return [`→ \`${fate.field}\``, `${short(fate.holder)} → ${short(fate.target)}; ${fate.how}`];
    case 'kept':
      return ['kept as is', fate.reason];
    case 'dropped':
      return ['dropped', fate.reason];
    case 'gsmap-link':
      return ['.gsmap link', `${fate.link}: ${fate.reason}`];
    case 'open':
      return ['**open**', `see ${code(fate.ambiguity)}`];
    case 'unclassified':
      return ['**STOP**', fate.reason];
  }
}

function edgeRows(edges: readonly ClassifiedEdge[]): string[] {
  const rows = ['| Edge | From | To | Label | Fate | Detail |', '|---|---|---|---|---|---|'];
  for (const { edge, fate } of edges) {
    const [what, detail] = fateText(fate);
    const at = edge.line ? `:${edge.line}` : edge.source === 'canvas' ? ' ' + edge.id.slice('canvas|'.length) : '';
    rows.push(
      `| ${cell(code(edge.source + at))} | ${cell(short(edge.from))} | ${cell(code(edge.to.startsWith('[[') ? edge.to : short(edge.to)))} | ${cell(edge.label ?? '')} | ${what} | ${cell(detail)} |`
    );
  }
  return rows;
}

export function renderReport(plan: MigrationPlan, gate: GateResult, meta: ReportMeta): string {
  const verdict = verdictOf(gate);
  const open = plan.ambiguities.filter((a) => !a.resolved);
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push('# Strategy migration report (dry run)', '');
  push(`- Vault: ${code(meta.vault)}`, `- Generated: ${meta.generatedAt}`, `- Resolutions: ${meta.resolutionsFile ? code(meta.resolutionsFile) : 'none'}`, '- Nothing was written to the vault.', '');
  const status = {
    stop: '**STOP.** Some legacy data is not covered by the classification rules (or the planner refused a file). That needs a new decision, not an answer in resolutions.yaml. See *Stop* below.',
    open: `**${open.length} open question(s).** Answer them in resolutions.yaml and re-run with \`--resolutions\`.`,
    'gate-failed': '**Parity gate failed** on a check that resolutions can\'t fix. This is a planner bug: do not apply.',
    passed: '**Parity gate passed.** No open questions. Ready for Phase 3 (apply).',
  }[verdict];
  push(`**Status:** ${status}`, '');

  // Summary
  const bySource = new Map<string, number>();
  const byFate = new Map<string, number>();
  for (const { edge, fate } of plan.edges) {
    bySource.set(edge.source, (bySource.get(edge.source) ?? 0) + 1);
    byFate.set(fate.kind, (byFate.get(fate.kind) ?? 0) + 1);
  }
  push('## Summary', '');
  push(`- Legacy edges (oracle): ${plan.edges.length} — ${[...bySource].map(([s, n]) => `${code(s)} ${n}`).join(', ')}`);
  push(`- Fates: ${[...byFate].map(([f, n]) => `${f} ${n}`).join(', ')}`);
  push(`- Strategy notes: ${plan.notes.length}; files to change: ${plan.changes.length}`);
  push(`- Questions: ${plan.ambiguities.length} (${open.length} open)`);
  if (plan.staleResolutions.length) push(`- Answers for questions no longer asked (kept under \`stale\`): ${plan.staleResolutions.length}`);
  push('');

  const blockers = plan.findings.filter((f) => f.severity === 'blocker');
  const unclassified = plan.edges.filter((e) => e.fate.kind === 'unclassified');
  if (blockers.length || unclassified.length) {
    push('## Stop: needs a new decision', '');
    for (const f of blockers) push(`- ${f.path ? code(f.path) + ': ' : ''}${f.message}`);
    if (unclassified.length) push('', ...edgeRows(unclassified));
    push('');
  }

  if (open.length) {
    push('## Open questions', '');
    for (const a of open) {
      push(`- ${code(a.key)}`, `  ${a.question}`, `  Answers: ${a.options.map(code).join(' · ')}`);
      if (a.error) push(`  **Answer rejected:** ${a.error}`);
    }
    push('');
  }

  push('## Parity gate', '');
  for (const c of gate.checks) {
    push(`- ${c.passed ? '✅' : '❌'} ${c.title}${c.passed ? '' : ` (${c.failures.length})`}`);
    for (const f of c.failures.slice(0, 50)) push(`  - ${f}`);
    if (c.failures.length > 50) push(`  - … ${c.failures.length - 50} more`);
  }
  push('');

  const listed = (kind: Fate['kind']) => plan.edges.filter((e) => e.fate.kind === kind);
  push('## Dropped (not written)', '');
  push(...(listed('dropped').length ? edgeRows(listed('dropped')) : ['None.']), '');
  push('## Kept as is (D13)', '');
  push(...(listed('kept').length ? edgeRows(listed('kept')) : ['None.']), '');

  push('## Every legacy edge and its fate', '', ...edgeRows(plan.edges), '');

  if (plan.derived.length) {
    push('## Relations no single legacy edge states ("AND" resolutions, `serves` implied by `requires`)', '');
    for (const d of plan.derived) push(`- \`${d.field}\` ${short(d.holder)} → ${short(d.target)} (${d.why})`);
    push('');
  }

  push('## Canvas → Strategy.gsmap', '');
  const g = plan.gsmap;
  push(`- Positions: ${Object.keys(g.positions).length} (${Object.keys(g.positions).join(', ') || 'none'})`);
  push(`- Cards: ${g.cards.length}${g.cards.map((c) => `\n  - ${c.id} (${c.kind}): ${cell(c.kind === 'text' ? JSON.stringify(c.text) : c.kind === 'note-ref' ? c.file : c.url)}${c.style ? ` ${code(JSON.stringify(c.style))}` : ''}`).join('')}`);
  push(`- Frames: ${g.frames.length}${g.frames.map((f) => `\n  - ${f.id}: ${JSON.stringify(f.label)}`).join('')}`);
  const end = (e: { card: string } | { note: string }) => ('card' in e ? `card ${e.card}` : e.note);
  push(`- Links: ${g.links.length}${g.links.map((l) => `\n  - ${l.id}: ${end(l.from)} → ${end(l.to)}${l.label ? ` "${l.label}"` : ''}`).join('')}`);
  push('');

  push('## Files to change', '');
  for (const c of plan.changes) {
    push(`- ${code(c.path)}${c.before === null ? ' (new)' : ''}`);
    for (const s of c.summary) push(`  - ${s}`);
  }
  push('');

  push('## Planned graph issues (Phase 1 `buildGraph` over the planned vault)', '');
  push(...(gate.graph.issues.length ? gate.graph.issues.map((i) => `- ${i.severity} ${code(i.code)} ${code(i.path)}${i.field ? ` ${code(i.field)}` : ''}: ${i.message}`) : ['None.']), '');

  const notes = plan.findings.filter((f) => f.severity !== 'blocker');
  push('## Other findings', '');
  push(...(notes.length ? notes.map((f) => `- ${f.severity}: ${f.path ? code(f.path) + ': ' : ''}${f.message}`) : ['None.']), '');

  return out.join('\n');
}

/** The resolutions skeleton: every question, with the answer already given (if any). */
export function renderResolutions(plan: MigrationPlan, previous: Record<string, unknown>, generatedAt: string): string {
  const items = plan.ambiguities.map((a) => {
    const item: Record<string, unknown> = { key: a.key, question: a.question, options: a.options, answer: a.answer ?? null };
    if (a.error) item.error = a.error;
    return item;
  });
  const stale = Object.fromEntries(plan.staleResolutions.map((k) => [k, previous[k]]));
  const doc: Record<string, unknown> = { version: RESOLUTIONS_VERSION, items };
  if (Object.keys(stale).length) doc.stale = stale;
  const header = [
    `# Migration resolutions, generated ${generatedAt} by tools/migrate.ts.`,
    '# Fill in each `answer` with one of its `options`, then re-run with --resolutions <this file>.',
    '# Do not edit `key`. Answers are carried over between runs; `stale` keeps answers to questions',
    '# that are no longer asked. This file holds real strategy content: never commit it.',
  ];
  return header.join('\n') + '\n' + stringify(doc, { lineWidth: 0, nullStr: '' });
}

/** Read answers back: `items[].answer` keyed by `items[].key`, plus `stale` answers. */
export function parseResolutions(text: string): Record<string, unknown> {
  const doc = parse(text) as { version?: unknown; items?: unknown; stale?: unknown } | null;
  if (!doc || typeof doc !== 'object') return {};
  if (doc.version !== undefined && doc.version !== RESOLUTIONS_VERSION) throw new Error(`Unsupported resolutions version ${String(doc.version)}.`);
  const out: Record<string, unknown> = {};
  if (doc.stale && typeof doc.stale === 'object') Object.assign(out, doc.stale);
  if (Array.isArray(doc.items)) {
    for (const item of doc.items as Record<string, unknown>[]) {
      if (item && typeof item.key === 'string' && item.answer != null && item.answer !== '') out[item.key] = item.answer;
    }
  }
  return out;
}
