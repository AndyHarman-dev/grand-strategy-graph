import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../src/core/frontmatter';
import { GSMAP_PATH } from '../../src/core/gsmap';
import { unifiedDiff } from '../../tools/migrate/diff';
import { parityGate } from '../../tools/migrate/parity';
import { applyPlan, planMigration } from '../../tools/migrate/plan';
import { parseResolutions, renderReport, renderResolutions } from '../../tools/migrate/report';
import type { EdgeSource, MigrationPlan } from '../../tools/migrate/types';
import { readTestVault } from '../support/fake-app';
import { graphOf, migratedTestVault } from '../support/v2';

const files = readTestVault();
const resolutions = parseResolutions(readFileSync(new URL('./fixtures/test-vault.resolutions.yaml', import.meta.url), 'utf8'));
const bare = planMigration(files);
const resolved = planMigration(files, { resolutions });

const B = {
  1: 'Strategy/Bets/B-1 Get a D7 visa.md',
  2: 'Strategy/Bets/B-2 Apply for a digital nomad visa.md',
  3: 'Strategy/Bets/B-3 Sell pottery at weekend markets.md',
  4: 'Strategy/Bets/B-4 Save 20000 for kiln and lease.md',
  5: 'Strategy/Bets/B-5 Learn Portuguese to B1.md',
  6: 'Strategy/Bets/B-6 Online ceramics course.md',
  7: 'Strategy/Bets/B-7  Part-time barista job.md',
  8: 'Strategy/Bets/B-8 Teach pottery workshops.md',
} as const;
const A2 = 'Strategy/Assumptions/A-2 Rent in Lisbon stays under 1200.md';
const FP1 = 'Strategy/Fixed Points/FP-1 Live in Portugal.md';

const after = (plan: MigrationPlan, path: string) => applyPlan(files, plan)[path];
const fm = (plan: MigrationPlan, path: string) => parseFrontmatter(after(plan, path)).frontmatter;
const fates = (plan: MigrationPlan, source: EdgeSource, from: string) =>
  plan.edges.filter((e) => e.edge.source === source && e.edge.from === from).map((e) => `${e.edge.to} ${e.fate.kind}`);
const canvasFate = (plan: MigrationPlan, id: string) => plan.edges.find((e) => e.edge.id === `canvas|${id}`)!.fate;

describe('oracle over the test vault', () => {
  it('captures every legacy edge from all five sources', () => {
    const count = (source: EdgeSource) => bare.oracle.filter((e) => e.source === source).length;
    expect({
      'fm:serves': count('fm:serves'),
      'fm:next sequel': count('fm:next sequel'),
      'body:serves': count('body:serves'),
      'body:assumptions': count('body:assumptions'),
      'body:depended-on-by': count('body:depended-on-by'),
      canvas: count('canvas'),
    }).toEqual({ 'fm:serves': 9, 'fm:next sequel': 1, 'body:serves': 8, 'body:assumptions': 10, 'body:depended-on-by': 7, canvas: 19 });
    expect(new Set(bare.oracle.map((e) => e.id)).size).toBe(bare.oracle.length);
  });

  it('records body links with their line, canvas edges with their label', () => {
    expect(bare.oracle.find((e) => e.source === 'body:assumptions' && e.to.includes('A-9'))).toMatchObject({ from: B[1], toPath: null, line: 30 });
    expect(bare.oracle.find((e) => e.id === 'canvas|e2')).toMatchObject({ from: B[1], to: B[2], toPath: B[2], label: 'On kill' });
    expect(bare.oracle.find((e) => e.id === 'canvas|e7')).toMatchObject({ from: 'card:t-and', to: B[4] });
  });

  it('leaves no edge unclassified and refuses no file', () => {
    expect(bare.edges.filter((e) => e.fate.kind === 'unclassified')).toEqual([]);
    expect(bare.findings.filter((f) => f.severity === 'blocker')).toEqual([]);
  });
});

describe('every anomaly in test-vault/ANOMALIES.md gets its expected outcome', () => {
  it('scalar `serves` is normalized to a list (B-1, B-6)', () => {
    expect(fm(bare, B[1]).serves).toEqual(['[[FP-1 Live in Portugal]]']);
    expect(fm(bare, B[6]).serves).toEqual(['[[FP-2 Profitable pottery business]]']);
  });

  it('placeholder `[[...]]` and self-loops in `serves` are asked about, never written (B-7, B-5)', () => {
    expect(fates(bare, 'fm:serves', B[7])).toEqual(['[[...]] open']);
    expect(fates(bare, 'fm:serves', B[5])).toEqual(['[[FP-1 Live in Portugal]] written', '[[B-5 Learn Portuguese to B1]] open']);
    expect(fm(bare, B[7]).serves).toBeNull();
    // B-4 requires B-5, so B-5 also serves B-4.
    expect(fm(bare, B[5]).serves).toEqual(['[[FP-1 Live in Portugal]]', '[[B-4 Save 20000 for kiln and lease]]']);
    expect(fates(resolved, 'fm:serves', B[5])[1]).toBe('[[B-5 Learn Portuguese to B1]] dropped');
  });

  it('malformed `[[FP-]]` (body serves) is dropped with the section; `[[A-]]` (body assumptions) is asked about (B-7)', () => {
    expect(fates(bare, 'body:serves', B[7])).toEqual(['[[FP-]] dropped']);
    expect(fates(bare, 'body:assumptions', B[7])).toEqual(['[[A-]] open']);
    expect(fm(bare, B[7]).assumptions).toBeUndefined();
    // The fixture retargets it.
    expect(fm(resolved, B[7]).assumptions).toEqual(['[[A-7 Workshops can fill eight seats]]']);
  });

  it('a dangling link is asked about and never written (B-1 → A-9)', () => {
    expect(fates(bare, 'body:assumptions', B[1])).toEqual([
      '[[A-1 D7 accepts freelance income]] written',
      '[[A-2 Rent in Lisbon stays under 1200]] written',
      '[[A-9 Testing new assumption]] open',
    ]);
    expect(after(resolved, B[1])).not.toContain('A-9');
  });

  it('the phantom root FP-2 link is kept as is and listed (D13); the root file is never touched', () => {
    expect(bare.edges.find((e) => e.edge.from === B[6] && e.edge.source === 'fm:serves')!.fate).toMatchObject({ kind: 'kept' });
    expect(bare.changes.map((c) => c.path)).not.toContain('FP-2 Profitable pottery business.md');
  });

  it('the same phantom link repeated in body `## Serves` is kept too, and writes no relation (B-6)', () => {
    expect(fates(bare, 'body:serves', B[6])).toEqual(['[[FP-2 Profitable pottery business]] kept']);
    expect(fm(bare, B[6]).serves).toEqual(['[[FP-2 Profitable pottery business]]']);
  });

  it('a note of a known non-graph type is left untouched (Strategic Inbox; D15)', () => {
    expect(bare.changes.map((c) => c.path)).not.toContain('Strategy/Strategic Inbox.md');
    expect(bare.findings.find((f) => f.path === 'Strategy/Strategic Inbox.md')).toMatchObject({ severity: 'info' });
  });

  it('body `## Serves` is dropped; body-only links are reported as dropped (B-3, B-8; D12)', () => {
    expect(fates(bare, 'body:serves', B[3])).toEqual(['[[FP-2 Own a profitable ceramics studio]] dropped']);
    expect(fates(bare, 'body:serves', B[8])).toEqual(['[[FP-2 Own a profitable ceramics studio]] dropped']);
    expect(fates(bare, 'body:serves', B[1])).toEqual(['[[FP-1 Live in Portugal]] written']);
    for (const path of Object.values(B)) expect(after(bare, path)).not.toMatch(/^## Serves$/m);
  });

  it('`next sequel` is renamed to `next` (B-1 → B-2)', () => {
    expect(fm(bare, B[1])).toMatchObject({ next: '[[B-2 Apply for a digital nomad visa]]' });
    expect(fm(bare, B[1])).not.toHaveProperty(['next sequel']);
    expect(after(bare, B[2])).toMatch(/^next:$/m);
  });

  it('bets listed as assumptions become `requires` (B-4 → B-3, B-5; D7)', () => {
    expect(fm(bare, B[4]).requires).toEqual(['[[B-3 Sell pottery at weekend markets]]', '[[B-5 Learn Portuguese to B1]]']);
  });

  it('forward and reverse assumption lists are unioned', () => {
    expect(fm(bare, B[4]).assumptions).toEqual(['[[A-2 Rent in Lisbon stays under 1200]]']); // reverse only (A-2)
    expect(fm(bare, B[3]).assumptions).toEqual(['[[A-3 Weekend market stalls are available]]', '[[A-4 Tourists buy handmade ceramics]]']); // A-3 forward only
    expect(fm(bare, B[1]).assumptions).toEqual(['[[A-1 D7 accepts freelance income]]', '[[A-2 Rent in Lisbon stays under 1200]]']); // both, once each
    expect(fm(bare, B[8]).assumptions).toEqual(['[[A-7 Workshops can fill eight seats]]']); // A-7 via B-8's body
  });

  it('bullet-less backlinks parse like bulleted ones; a fixed point dependent gets `assumptions` (A-4, A-6 → FP-1)', () => {
    expect(fates(bare, 'body:depended-on-by', 'Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md')).toEqual(['[[B-3 Sell pottery at weekend markets]] written']);
    expect(fm(bare, FP1).assumptions).toEqual(['[[A-6 Portugal stays open to non-EU residents]]']);
    expect(fates(bare, 'body:depended-on-by', 'Strategy/Assumptions/A-1 D7 accepts freelance income.md')).toEqual(['[[B-1 Get a D7 visa]] written']);
  });

  it('ids come from the basename, including the double-space one; Current Position gets type and id', () => {
    expect(bare.notes.map((n) => n.id)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'CP', 'FP-1', 'FP-2']);
    expect(after(bare, B[7])).toMatch(/^---\nid: B-7\ntype: bet\n/);
    expect(after(bare, 'Strategy/Current Position.md')).toBe('---\nid: CP\ntype: current-position\ndate: 2026-08-01\n---\n# Situation\nSynthetic test position: employed remotely, saving money, hobby potter.\n');
  });

  it('extra keys, block scalars and datetimes survive verbatim', () => {
    expect(after(bare, B[6])).toContain('\ncategories:\n  - "[[Learning]]"\ntype: bet\n');
    expect(after(bare, B[4])).toContain('expected-result: |-\n  Saved 20000 EUR:\n  1) kiln fund\n  2) first lease deposit\n');
    expect(after(bare, 'Strategy/Assumptions/A-1 D7 accepts freelance income.md')).toContain('created: 2026-07-05T10:00:00\nverify-by: 2026-07-20T18:00:00\n');
  });

  it('bet statuses are normalized (D6); assumption statuses, undeterminable included, are not (D13)', () => {
    const statuses = (plan: MigrationPlan) => Object.fromEntries(plan.notes.map((n) => [n.id, fm(plan, n.path).status ?? null]));
    expect(statuses(bare)).toMatchObject({
      'B-1': 'active', 'B-2': 'dormant', 'B-5': 'won', 'B-6': 'killed', 'B-8': 'dormant',
      'A-1': 'confirmed', 'A-3': 'falsified', 'A-4': 'undeterminable', 'A-5': 'unverified',
    });
  });

  it('`## Depended On By` becomes a Dataview block; the other assumption sections stay', () => {
    const a2 = after(bare, A2);
    expect(a2).toContain('## Depended On By\n```dataview\nLIST\nFROM "Strategy"\nWHERE contains(assumptions, this.file.link)\nSORT file.name ASC\n```\n\n## Log\n');
    expect(a2).not.toContain('- [[B-1');
  });

  it('templates are rewritten to schema v2; the weekly review template is untouched', () => {
    expect(after(bare, 'Templates/Bet Template.md')).toBe(
      '---\nid:\ntype: bet\nstatus: active\nstarted:\ndeadline:\nexpected-result:\nserves:\nrequires:\nnext:\nassumptions:\n---\n## The Bet\n\n## Kill Condition (decided NOW, before the deadline)\n\n## Log\n\n## Resolution\n'
    );
    expect(after(bare, 'Templates/Assumption Template.md')).toContain('---\nid:\ntype: assumption\n');
    expect(after(bare, 'Templates/Assumption Template.md')).toContain('## Depended On By\n```dataview\n');
    expect(bare.changes.map((c) => c.path)).not.toContain('Templates/Weekly Review Template.md');
  });
});

describe('canvas → .gsmap', () => {
  const map = bare.gsmap;

  it('puts every file node position under its note id, and the non-strategy note on a note-reference card', () => {
    expect(Object.keys(map.positions)).toEqual(['CP', 'B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'FP-1', 'FP-2']);
    expect(map.positions['B-7']).toEqual({ x: 900, y: 1500 });
    expect(map.cards.find((c) => c.id === 'note')).toEqual({ id: 'note', kind: 'note-ref', file: 'lisbon-neighbourhoods-research.md', x: -700, y: 0, width: 400, height: 300, color: '2' });
    expect(bare.canvasNodes.every((n) => n.placed)).toBe(true);
  });

  it('turns groups into frames and text cards into free cards with their style', () => {
    expect(map.frames.map((f) => [f.id, f.label])).toEqual([['g-visa', 'Visa route'], ['g-studio', 'Studio route']]);
    expect(map.cards.find((c) => c.id === 't-ghost')).toMatchObject({ kind: 'text', text: 'Golden visa path?', color: '2', style: { textAlign: 'center' } });
    expect(map.cards.find((c) => c.id === 't-routec')).toMatchObject({ style: { border: 'dashed' } });
  });

  it('drops the "AND" diamond whose lines match B-4 `requires` B-3, B-5: the graph draws it', () => {
    expect(['e5', 'e6', 'e7'].map((id) => canvasFate(bare, id).kind)).toEqual(['dropped', 'dropped', 'dropped']);
    expect(bare.ambiguities.map((a) => a.kind)).not.toContain('junction');
    expect(bare.findings.some((f) => f.message.includes('"AND" card t-and matches `requires`'))).toBe(true);
    expect(map.cards.map((c) => c.id)).not.toContain('t-and');
    expect(bare.canvasNodes.find((n) => n.node === 't-and')?.placed).toBe('junction:t-and');
    expect(bare.junctions).toEqual([{ card: 't-and', requires: [{ holder: B[4], target: B[3] }, { holder: B[4], target: B[5] }] }]);
  });

  it('matches "On kill" to `next`, and other note↔note edges to existing relations', () => {
    expect(canvasFate(bare, 'e2')).toMatchObject({ kind: 'written', field: 'next', holder: B[1], target: B[2] });
    expect(canvasFate(bare, 'e3')).toMatchObject({ kind: 'written', field: 'assumptions' });
    expect(canvasFate(bare, 'e8')).toMatchObject({ kind: 'written', field: 'serves', holder: B[8], target: B[4] }); // "indirectly serves"
  });

  it('drops edges touching a group, "On Kill" included, and keeps the group as a frame (e18, e19; D14)', () => {
    expect(canvasFate(bare, 'e18')).toMatchObject({ kind: 'dropped', reason: expect.stringContaining('D14') });
    expect(canvasFate(bare, 'e19')).toMatchObject({ kind: 'dropped', reason: expect.stringContaining('D14') });
    expect(fm(bare, B[6]).next).toBeNull();
  });

  it('asks about canvas-only edges (candidate relations) and keeps card links', () => {
    expect(['e12', 'e13', 'e16'].map((id) => canvasFate(bare, id).kind)).toEqual(['open', 'open', 'open']);
    expect(canvasFate(bare, 'e10')).toMatchObject({ kind: 'gsmap-link' }); // "Only A-6" from the ghost card
    expect(map.links.find((l) => l.id === 'e11')).toMatchObject({ from: { card: 'note' }, to: { note: 'B-1' }, label: 'Non significant relationship' });
    expect(canvasFate(resolved, 'e13')).toMatchObject({ kind: 'written', field: 'serves', holder: B[7], target: B[4] });
    expect(resolved.gsmap.links.find((l) => l.id === 'e12')).toMatchObject({ from: { note: 'B-6' }, to: { note: 'FP-2' }, label: 'Killed' });
  });
});

describe('parity gate', () => {
  it('passes on the test vault once the fixture resolutions are in', async () => {
    const gate = await parityGate(files, resolved);
    expect(gate.checks.filter((c) => !c.passed)).toEqual([]);
    expect(resolved.ambiguities.every((a) => a.resolved)).toBe(true);
    expect(resolved.staleResolutions).toEqual([]);
  });

  it('fails only on open questions without them', async () => {
    const gate = await parityGate(files, bare);
    expect(gate.checks.filter((c) => !c.passed).map((c) => [c.name, c.failures.length])).toEqual([['no-open-ambiguities', 7]]);
  });

  it('builds the same graph as the hand-written v2 vault, except the phantom link kept by D13', async () => {
    const gate = await parityGate(files, bare);
    const v2 = await graphOf(migratedTestVault());
    const edges = (g: typeof v2) => g.edges.map((e) => `${e.kind} ${e.from}>${e.to}`).sort();
    expect(edges(gate.graph)).toEqual(edges(v2).filter((e) => e !== 'serves B-6>FP-2'));
    expect(gate.graph.issues.map((i) => `${i.code} ${i.field}`)).toEqual(['non-strategy-target serves']);
  });

  it('is idempotent: planning the planned vault changes nothing', async () => {
    const planned = applyPlan(files, resolved);
    const again = planMigration(planned, { resolutions });
    expect(again.changes).toEqual([]);
    expect(again.edges.filter((e) => ['open', 'unclassified'].includes(e.fate.kind))).toEqual([]);
    expect((await parityGate(planned, again)).passed).toBe(true);
  });

  describe('catches a planner that gets it wrong', () => {
    const tamper = (path: string, edit: (text: string) => string): MigrationPlan => ({
      ...resolved,
      changes: resolved.changes.map((c) => (c.path === path ? { ...c, after: edit(c.after) } : c)),
    });
    const failing = async (plan: MigrationPlan) => (await parityGate(files, plan)).checks.filter((c) => !c.passed).map((c) => c.name);

    it('a dropped relation', async () => {
      // The "AND" card that stood for it is missing its requires too.
      expect(await failing(tamper(B[4], (t) => t.replace('  - "[[B-5 Learn Portuguese to B1]]"\n', '')))).toEqual(['relations-present', 'canvas-placed']);
    });

    it('an invented relation', async () => {
      expect(await failing(tamper(B[2], (t) => t.replace('next:\n', 'next: "[[B-8 Teach pottery workshops]]"\n')))).toEqual(['nothing-invented']);
    });

    it('a changed byte of prose, or of an unmanaged key', async () => {
      expect(await failing(tamper(B[3], (t) => t.replace('ten weeks', 'ten  weeks')))).toEqual(['prose-unchanged']);
      expect(await failing(tamper(B[6], (t) => t.replace('[[Learning]]', '[[Learn]]')))).toEqual(['prose-unchanged']);
      expect(await failing(tamper(A2, (t) => t.replace('SORT file.name ASC\n', '')))).toEqual(['prose-unchanged']);
    });

    it('a lost canvas position', async () => {
      const plan = { ...resolved, gsmap: { ...resolved.gsmap, positions: { ...resolved.gsmap.positions } } };
      delete plan.gsmap.positions['A-3'];
      expect(await failing(plan)).toEqual(['canvas-placed']);
    });
  });
});

describe('outputs over the test vault (goldens)', () => {
  const meta = { vault: 'test-vault', generatedAt: '2026-10-01T00:00:00.000Z', resolutionsFile: null };

  it('report and resolutions skeleton', async () => {
    await expect(renderReport(bare, await parityGate(files, bare), meta)).toMatchFileSnapshot('./__golden__/test-vault.report.md');
    await expect(renderResolutions(bare, {}, meta.generatedAt)).toMatchFileSnapshot('./__golden__/test-vault.resolutions.yaml');
  });

  it('report once resolved', async () => {
    const report = renderReport(resolved, await parityGate(files, resolved), { ...meta, resolutionsFile: 'test-vault.resolutions.yaml' });
    await expect(report).toMatchFileSnapshot('./__golden__/test-vault.resolved.report.md');
  });

  it('planned diff, .gsmap and oracle', async () => {
    await expect(resolved.changes.map((c) => unifiedDiff(c.path, c.before, c.after)).join('\n')).toMatchFileSnapshot('./__golden__/test-vault.diff');
    await expect(after(resolved, GSMAP_PATH)).toMatchFileSnapshot('./__golden__/test-vault.Strategy.gsmap');
    await expect(JSON.stringify(bare.oracle, null, 2) + '\n').toMatchFileSnapshot('./__golden__/test-vault.legacy-edges.json');
  });
});
