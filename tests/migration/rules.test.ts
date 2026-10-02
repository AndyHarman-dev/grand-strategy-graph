import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../src/core/frontmatter';
import { parityGate } from '../../tools/migrate/parity';
import { applyPlan, planMigration } from '../../tools/migrate/plan';
import { verdictOf } from '../../tools/migrate/report';
import type { MigrationPlan } from '../../tools/migrate/types';

const FP1 = 'Strategy/Fixed Points/FP-1 Home.md';
const B1 = 'Strategy/Bets/B-1 First.md';
const B2 = 'Strategy/Bets/B-2 Second.md';
const B3 = 'Strategy/Bets/B-3 Third.md';
const A1 = 'Strategy/Assumptions/A-1 Holds.md';
const CANVAS = 'Strategy/The Map.canvas';

const list = (links: string[]) => links.map((l) => `- ${l}`).join('\n');
/** A legacy bet as the old plugin wrote it. */
const bet = (fm: string, serves: string[] = [], assumptions: string[] = []) =>
  `---\ntype: bet\nstatus: active\n${fm}---\n## The Bet\nText.\n\n## Serves\nWhich fixed point / direction does this bet serve?\n${list(serves)}\n\n## Assumptions This Bet Depends On\n${list(assumptions)}\n\n## Log\n- created\n`;
const assumption = (dependents: string[] = [], status = 'unverified') =>
  `---\ntype: assumption\nstatus: ${status}\n---\n## The Assumption\nIt holds.\n\n## Depended On By\n${list(dependents)}\n\n## Log\n- created\n`;
const vault = (extra: Record<string, string>) => ({ [FP1]: '---\ntype: fixed-point\n---\nStatement.\n', ...extra });
const canvas = (nodes: object[], edges: object[]) => JSON.stringify({ nodes, edges });
const fileNode = (id: string, file: string, x = 0) => ({ id, type: 'file', file, x, y: 0, width: 400, height: 300 });

const after = (files: Record<string, string>, plan: MigrationPlan, path: string) => applyPlan(files, plan)[path];
const fm = (files: Record<string, string>, plan: MigrationPlan, path: string) => parseFrontmatter(after(files, plan, path)).frontmatter;
const kinds = (plan: MigrationPlan) => plan.edges.map((e) => `${e.edge.source} ${e.fate.kind}`);

describe('edges no rule covers stop the migration', () => {
  it('a reverse list naming the current position', async () => {
    const files = vault({ [A1]: assumption(['[[Current Position]]']), 'Strategy/Current Position.md': '---\ndate: 2026-01-01\n---\n' });
    const plan = planMigration(files);
    expect(plan.edges[0].fate).toMatchObject({ kind: 'unclassified', reason: expect.stringContaining('current-position') });
    expect(verdictOf(await parityGate(files, plan))).toBe('stop');
  });

  it('a bet\'s assumption list naming a fixed point', () => {
    const plan = planMigration(vault({ [B1]: bet('serves:\n', [], ['[[FP-1 Home]]']) }));
    expect(plan.edges.find((e) => e.edge.source === 'body:assumptions')!.fate.kind).toBe('unclassified');
  });

  it('frontmatter `serves` pointing at an assumption is left in place, unclassified', () => {
    const files = vault({ [B1]: bet('serves: "[[A-1 Holds]]"\n'), [A1]: assumption() });
    const plan = planMigration(files);
    expect(plan.edges.find((e) => e.edge.source === 'fm:serves')!.fate.kind).toBe('unclassified');
    expect(fm(files, plan, B1).serves).toEqual(['[[A-1 Holds]]']);
  });

  it('a canvas edge touching a group, and an unknown canvas node type', async () => {
    const files = vault({
      [B1]: bet('serves:\n'),
      [CANVAS]: canvas(
        [fileNode('b1', B1), { id: 'g', type: 'group', label: 'G', x: 0, y: 0, width: 1, height: 1 }, { id: 'w', type: 'widget', x: 0, y: 0 }],
        [{ id: 'e1', fromNode: 'b1', toNode: 'g' }]
      ),
    });
    const plan = planMigration(files);
    expect(kinds(plan)).toEqual(['canvas unclassified']);
    expect(plan.findings.filter((f) => f.severity === 'blocker').map((f) => f.message)).toEqual([expect.stringContaining('"widget"')]);
    const gate = await parityGate(files, plan);
    expect(gate.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(['no-blockers', 'zero-unaccounted', 'canvas-placed']);
  });
});

describe('managed sections with other text', () => {
  const files = vault({ [B1]: bet('serves:\n', [], ['[[A-1 Holds]] — only if rent stays low', 'Also see the spreadsheet.']), [A1]: assumption() });
  const key = `section: ${B1} / Assumptions This Bet Depends On`;

  it('asks before deleting, keeps the section until answered, and still reads its links', () => {
    const plan = planMigration(files);
    expect(plan.ambiguities.find((a) => a.key === key)?.question).toContain('"- Also see the spreadsheet."');
    expect(after(files, plan, B1)).toContain('## Assumptions This Bet Depends On\n- [[A-1 Holds]] — only if rent stays low\n');
    expect(after(files, plan, B1)).not.toContain('## Serves');
    expect(fm(files, plan, B1).assumptions).toEqual(['[[A-1 Holds]]']);
  });

  it('removes or keeps it as answered, and rejects other answers', async () => {
    const removed = planMigration(files, { resolutions: { [key]: 'remove' } });
    expect(after(files, removed, B1)).not.toContain('spreadsheet');
    expect((await parityGate(files, removed)).passed).toBe(true);
    const kept = planMigration(files, { resolutions: { [key]: 'keep' } });
    expect(after(files, kept, B1)).toContain('Also see the spreadsheet.');
    expect((await parityGate(files, kept)).passed).toBe(true);
    const bad = planMigration(files, { resolutions: { [key]: 'maybe' } });
    expect(bad.ambiguities.find((a) => a.key === key)).toMatchObject({ resolved: false, error: 'expected remove or keep' });
  });

  it('ignores headings inside fenced code', () => {
    const body = bet('serves:\n', ['[[FP-1 Home]]']).replace('- [[FP-1 Home]]', '```\n## Log\n```\n- [[FP-1 Home]]');
    const plan = planMigration(vault({ [B1]: body }));
    expect(plan.edges.filter((e) => e.edge.source === 'body:serves').map((e) => e.edge.to)).toEqual(['[[FP-1 Home]]']);
  });
});

describe('ids', () => {
  it('asks when two names give the same id, or none can be parsed', () => {
    const files = vault({ [B1]: bet('serves:\n'), 'Strategy/Bets/B-01 Again.md': bet('serves:\n'), 'Strategy/Bets/Side project.md': bet('serves:\n') });
    const plan = planMigration(files);
    expect(plan.ambiguities.map((a) => a.key)).toEqual([`id: Strategy/Bets/B-01 Again.md`, `id: ${B1}`, 'id: Strategy/Bets/Side project.md']);
    expect(plan.notes.map((n) => n.id)).toEqual([null, null, null, 'FP-1']);
    expect(after(files, plan, B1)).not.toMatch(/^id:/m);
  });

  it('uses the answers, but not when they collide', () => {
    const files = vault({ [B1]: bet('serves:\n'), 'Strategy/Bets/B-01 Again.md': bet('serves:\n') });
    const ok = planMigration(files, { resolutions: { [`id: ${B1}`]: { id: 'B-1' }, 'id: Strategy/Bets/B-01 Again.md': 'B-9' } });
    expect(ok.notes.map((n) => n.id)).toEqual(['B-9', 'B-1', 'FP-1']);
    const clash = planMigration(files, { resolutions: { [`id: ${B1}`]: { id: 'B-1' }, 'id: Strategy/Bets/B-01 Again.md': { id: 'B-1' } } });
    expect(clash.ambiguities.map((a) => a.error)).toEqual(['id "B-1" is still used by 2 notes', 'id "B-1" is still used by 2 notes']);
  });

  it('keeps an explicit id', () => {
    const files = vault({ [B1]: bet('id: B-77\nserves:\n') });
    expect(planMigration(files).notes.find((n) => n.path === B1)!.id).toBe('B-77');
  });
});

describe('statuses', () => {
  it('asks about an unknown status and applies a valid answer', () => {
    const files = vault({ [B1]: bet('serves:\n').replace('status: active', 'status: paused') });
    const key = `status: ${B1}`;
    expect(planMigration(files).ambiguities.map((a) => a.key)).toEqual([key]);
    const answered = planMigration(files, { resolutions: { [key]: { status: 'dormant' } } });
    expect(fm(files, answered, B1).status).toBe('dormant');
    const wrong = planMigration(files, { resolutions: { [key]: 'asleep' } });
    expect(wrong.ambiguities[0].error).toContain('expected one of active');
  });
});

describe('notes the planner refuses to rewrite', () => {
  it('YAML that would not re-serialize byte for byte, or does not parse', () => {
    const files = vault({ [B1]: bet('serves:   "[[FP-1 Home]]"\n'), [B2]: bet('serves: [oops\n') });
    const plan = planMigration(files);
    expect(plan.changes.map((c) => c.path)).not.toContain(B1);
    expect(plan.findings.filter((f) => f.severity === 'blocker').map((f) => f.path)).toEqual([B1, B2]);
  });
});

describe('formats', () => {
  it('keeps CRLF line endings', async () => {
    const files = vault({ [B1]: bet('serves: "[[FP-1 Home]]"\n', ['[[FP-1 Home]]']).replace(/\n/g, '\r\n') });
    const plan = planMigration(files);
    const text = after(files, plan, B1);
    expect(text).toContain('id: B-1\r\ntype: bet\r\n');
    expect(text).toContain('serves:\r\n  - "[[FP-1 Home]]"\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect((await parityGate(files, plan)).passed).toBe(true);
  });

  it('gives a Current Position without frontmatter one', () => {
    const files = vault({ 'Strategy/Current Position.md': '# Situation\nNow.\n' });
    const plan = planMigration(files);
    expect(after(files, plan, 'Strategy/Current Position.md')).toBe('---\nid: CP\ntype: current-position\n---\n# Situation\nNow.\n');
  });

  it('keeps the final line break when the removed section ends the file', () => {
    const files = vault({ [B1]: '---\ntype: bet\nstatus: active\nserves:\n---\nIntro.\n\n## Serves\n- [[FP-1 Home]]\n' });
    expect(after(files, planMigration(files), B1)).toMatch(/---\nIntro\.\n\n$/);
  });

  it('unions existing v2 fields with the legacy lists, without duplicates', () => {
    const files = vault({ [B1]: bet('serves:\nassumptions:\n  - "[[A-1 Holds]]"\n', [], ['[[A-1 Holds]]']), [A1]: assumption(['[[B-1 First]]']) });
    const plan = planMigration(files);
    expect(fm(files, plan, B1).assumptions).toEqual(['[[A-1 Holds]]']);
    expect(kinds(plan)).toEqual(['fm:assumptions written', 'body:assumptions written', 'body:depended-on-by written']);
  });
});

describe('answers to link questions', () => {
  const files = vault({ [B1]: bet('serves: "[[FP-9 Gone]]"\n'), [A1]: assumption() });
  const key = 'link: B-1 First / fm:serves / [[FP-9 Gone]]';

  it('retargets to a valid note, and rejects dangling or wrong-type targets', () => {
    const ok = planMigration(files, { resolutions: { [key]: { retarget: '[[FP-1 Home]]' } } });
    expect(fm(files, ok, B1).serves).toEqual(['[[FP-1 Home]]']);
    const dangling = planMigration(files, { resolutions: { [key]: { retarget: '[[FP-8 Also gone]]' } } });
    expect(dangling.ambiguities[0].error).toContain('dangling');
    const wrongType = planMigration(files, { resolutions: { [key]: { retarget: '[[A-1 Holds]]' } } });
    expect(wrongType.ambiguities[0].error).toBe("`serves` on a bet can't point at an assumption");
  });

  it('reports answers to questions no longer asked as stale', () => {
    const plan = planMigration(files, { resolutions: { 'link: gone / fm:serves / [[x]]': 'drop' } });
    expect(plan.staleResolutions).toEqual(['link: gone / fm:serves / [[x]]']);
  });
});

describe('canvas rules', () => {
  const nodes = [fileNode('b1', B1), fileNode('b2', B2), fileNode('b3', B3), fileNode('a1', A1), fileNode('fp', FP1)];
  const base = { [B1]: bet('serves:\nnext sequel:\n'), [B2]: bet('serves:\n'), [B3]: bet('serves:\n'), [A1]: assumption() };

  it('"On kill" adds `next` when there is none, and asks when there is another', () => {
    const files = vault({ ...base, [CANVAS]: canvas(nodes, [{ id: 'k', fromNode: 'b1', toNode: 'b2', label: 'On kill' }]) });
    const plan = planMigration(files);
    expect(fm(files, plan, B1).next).toBe('[[B-2 Second]]');
    const conflict = vault({ ...base, [B1]: bet('serves:\nnext sequel: "[[B-3 Third]]"\n'), [CANVAS]: canvas(nodes, [{ id: 'k', fromNode: 'b1', toNode: 'b2', label: 'On kill' }]) });
    expect(planMigration(conflict).ambiguities.map((a) => a.key)).toEqual(['canvas-edge: k']);
  });

  it('turns a candidate edge into the relation named in the answer', async () => {
    const files = vault({ ...base, [CANVAS]: canvas(nodes, [{ id: 'x', fromNode: 'a1', toNode: 'b2' }, { id: 'y', fromNode: 'b3', toNode: 'b1' }]) });
    const plan = planMigration(files, { resolutions: { 'canvas-edge: x': { relation: 'assumptions' }, 'canvas-edge: y': { relation: 'serves', reversed: true } } });
    expect(fm(files, plan, B2).assumptions).toEqual(['[[A-1 Holds]]']); // the non-assumption end holds it
    expect(fm(files, plan, B1).serves).toEqual(['[[B-3 Third]]']);
    expect((await parityGate(files, plan)).passed).toBe(true);
    const wrong = planMigration(files, { resolutions: { 'canvas-edge: x': { relation: 'requires' } } });
    expect(wrong.ambiguities.find((a) => a.key === 'canvas-edge: x')?.error).toContain("can't have `requires`");
  });

  it('asks about an "AND" junction that the notes don\'t already state, and writes `requires` when told', async () => {
    const and = { id: 'and', type: 'text', text: 'AND', x: 0, y: 0, width: 80, height: 80 };
    const files = vault({
      ...base,
      [CANVAS]: canvas([...nodes, and], [{ id: 'i1', fromNode: 'b1', toNode: 'and' }, { id: 'i2', fromNode: 'b2', toNode: 'and' }, { id: 'o', fromNode: 'and', toNode: 'b3' }]),
    });
    expect(planMigration(files).ambiguities.map((a) => a.key)).toEqual(['junction: and']);
    const plan = planMigration(files, { resolutions: { 'junction: and': 'requires' } });
    expect(fm(files, plan, B3).requires).toEqual(['[[B-1 First]]', '[[B-2 Second]]']);
    expect(plan.derived).toHaveLength(2);
    expect((await parityGate(files, plan)).passed).toBe(true);
    const none = planMigration(files, { resolutions: { 'junction: and': 'none' } });
    expect(fm(files, none, B3).requires).toBeUndefined();
  });

  it('turns a second node for the same note into a note-reference card', async () => {
    const files = vault({ ...base, [CANVAS]: canvas([fileNode('b1', B1, 10), fileNode('b1-again', B1, 20)], []) });
    const plan = planMigration(files);
    expect(plan.gsmap.positions['B-1']).toEqual({ x: 10, y: 0 });
    expect(plan.gsmap.cards).toEqual([expect.objectContaining({ id: 'b1-again', kind: 'note-ref', file: B1 })]);
    expect((await parityGate(files, plan)).checks.find((c) => c.name === 'canvas-placed')!.passed).toBe(true);
  });
});

describe('links to a non-strategy note (D13)', () => {
  const PHANTOM = 'FP-9 Phantom.md';

  it('a body `## Serves` link that repeats a kept frontmatter link is kept, not written', async () => {
    const files = vault({ [PHANTOM]: '', [B1]: bet('serves:\n  - "[[FP-9 Phantom]]"\n', ['[[FP-9 Phantom]]']) });
    const plan = planMigration(files);
    expect(plan.edges.map((e) => `${e.edge.source} ${e.fate.kind}`)).toEqual(['fm:serves kept', 'body:serves kept']);
    expect(fm(files, plan, B1).serves).toEqual(['[[FP-9 Phantom]]']);
    const gate = await parityGate(files, plan);
    expect(gate.checks.find((c) => c.name === 'relations-present')!.failures).toEqual([]);
    expect(verdictOf(gate)).toBe('passed');
  });
});
