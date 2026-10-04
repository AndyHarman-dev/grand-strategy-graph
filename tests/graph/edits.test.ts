import { beforeEach, describe, expect, it } from 'vitest';
import { planIntent, relationCandidates, type EditEnv, type Intent } from '../../src/core/edits';
import { buildGraph } from '../../src/core/graph';
import { MemoryAdapter } from '../../src/core/memory-adapter';
import { MemoryVault } from '../../src/core/memory-vault';
import { isPlanError } from '../../src/core/plan';
import { findSmells } from '../../src/core/smells';
import { runWrites } from '../../src/core/writes';
import { plannedTestVault } from '../../tools/test-vault';

const TODAY = '2026-10-04';
const B1 = 'Strategy/Bets/B-1 Get a D7 visa.md';
const B2 = 'Strategy/Bets/B-2 Apply for a digital nomad visa.md';
const B3 = 'Strategy/Bets/B-3 Sell pottery at weekend markets.md';
const A3 = 'Strategy/Assumptions/A-3 Weekend market stalls are available.md';

let vault: MemoryVault;

beforeEach(() => {
  vault = new MemoryVault(plannedTestVault());
});

const graph = async () => buildGraph(await new MemoryAdapter(vault.files).readNotes());

/** Plan an intent over the vault as it is now, perform it, and give back the plan and the new graph. */
async function run(intent: Intent) {
  const g = await graph();
  const plan = planIntent(intent, { graph: g, vault, today: TODAY } satisfies EditEnv);
  if (isPlanError(plan)) return { error: plan.error, graph: g };
  const result = await runWrites(plan.writes, vault);
  expect(result.error).toBeNull();
  return { plan, graph: await graph() };
}

const node = (g: Awaited<ReturnType<typeof graph>>, key: string) => g.nodes.find((n) => n.key === key)!;
const edge = (g: Awaited<ReturnType<typeof graph>>, key: string) => g.edges.some((e) => e.key === key);

describe('set-status', () => {
  it('changes only the status line of the note', async () => {
    const before = vault.files[B1];
    const { graph: g } = await run({ kind: 'set-status', key: 'B-1', status: 'extended' });
    expect(node(g, 'B-1').status).toBe('extended');
    expect(vault.files[B1].replace('status: extended', 'status: active')).toBe(before);
  });

  it('refuses a status the type does not have, and a note without status', async () => {
    expect((await run({ kind: 'set-status', key: 'B-1', status: 'reached' })).error).toContain('is not a status of a bet');
    expect((await run({ kind: 'set-status', key: 'FP-1', status: 'active' })).error).toContain('no status');
    expect((await run({ kind: 'set-status', key: 'B-99', status: 'active' })).error).toContain('not on the graph');
  });

  it('plans nothing when the status already is that', async () => {
    const { plan } = await run({ kind: 'set-status', key: 'B-1', status: 'active' });
    expect(plan!.writes).toEqual([]);
  });
});

describe('set-date and set-text', () => {
  it('sets a deadline, and clears it to an empty key', async () => {
    let { graph: g } = await run({ kind: 'set-date', key: 'B-1', value: '2027-01-15' });
    expect(node(g, 'B-1').deadline).toBe('2027-01-15');
    ({ graph: g } = await run({ kind: 'set-date', key: 'B-1', value: '' }));
    expect(node(g, 'B-1').deadline).toBeNull();
    expect(vault.files[B1]).toContain('\ndeadline:\n');
  });

  it('sets verify-by on an assumption, and refuses a bad date or a type without one', async () => {
    const { graph: g } = await run({ kind: 'set-date', key: 'A-3', value: '2026-11-01' });
    expect(node(g, 'A-3').verifyBy).toBe('2026-11-01');
    expect((await run({ kind: 'set-date', key: 'B-1', value: '01/02/2026' })).error).toContain('not a date');
    expect((await run({ kind: 'set-date', key: 'FP-1', value: '2026-11-01' })).error).toContain('no deadline or verify-by');
  });

  it('sets a bet\'s expected result and replaces only an assumption\'s falsifier section', async () => {
    await run({ kind: 'set-text', key: 'B-1', field: 'expected-result', value: ' Visa in hand ' });
    expect(node(await graph(), 'B-1').frontmatter['expected-result']).toBe('Visa in hand');
    const before = vault.files[A3];
    await run({ kind: 'set-text', key: 'A-3', field: 'falsifier', value: 'Stalls cost over 80 a day' });
    const after = vault.files[A3];
    expect(after).toContain("## How I'd Know It's False\nStalls cost over 80 a day\n");
    const strip = (t: string) => t.replace(/## How I'd Know It's False\n[\s\S]*?(?=\n## )/, '');
    expect(strip(after)).toBe(strip(before));
    expect((await run({ kind: 'set-text', key: 'B-1', field: 'falsifier', value: 'x' })).error).toContain('only an assumption');
    expect((await run({ kind: 'set-text', key: 'A-3', field: 'falsifier', value: 'fine\n## Sneaky' })).error).toContain("can't contain a heading line");
  });
});

describe('relations', () => {
  it('adds and removes a link, and the graph follows', async () => {
    let { graph: g } = await run({ kind: 'add-relation', holder: 'B-7', field: 'serves', target: 'FP-1' });
    expect(edge(g, 'serves:B-7>FP-1')).toBe(true);
    expect(vault.files['Strategy/Bets/B-7  Part-time barista job.md']).toContain('[[FP-1 Live in Portugal]]');
    ({ graph: g } = await run({ kind: 'remove-relation', holder: 'B-7', field: 'serves', target: 'FP-1' }));
    expect(edge(g, 'serves:B-7>FP-1')).toBe(false);
  });

  it('removes one link and keeps its neighbours, and a scalar link too', async () => {
    const { graph: g } = await run({ kind: 'remove-relation', holder: 'B-4', field: 'requires', target: 'B-3' });
    expect(edge(g, 'requires:B-4>B-3')).toBe(false);
    expect(edge(g, 'requires:B-4>B-5')).toBe(true);
    const scalar = await run({ kind: 'remove-relation', holder: 'B-1', field: 'next', target: 'B-2' });
    expect(edge(scalar.graph, 'next:B-1>B-2')).toBe(false);
  });

  it('sets `next` as one link, and refuses a second one', async () => {
    await run({ kind: 'remove-relation', holder: 'B-1', field: 'next', target: 'B-2' });
    const { graph: g } = await run({ kind: 'add-relation', holder: 'B-1', field: 'next', target: 'B-8' });
    expect(edge(g, 'next:B-1>B-8')).toBe(true);
    expect((await run({ kind: 'add-relation', holder: 'B-1', field: 'next', target: 'B-2' })).error).toContain('already has a next sequel');
  });

  it('refuses what the schema does not allow, a repeat, and a link to itself', async () => {
    expect((await run({ kind: 'add-relation', holder: 'FP-1', field: 'serves', target: 'FP-2' })).error).toContain("can't have serves");
    expect((await run({ kind: 'add-relation', holder: 'B-1', field: 'assumptions', target: 'B-2' })).error).toContain('can only point at assumption');
    expect((await run({ kind: 'add-relation', holder: 'B-1', field: 'serves', target: 'FP-1' })).error).toContain('already');
    expect((await run({ kind: 'add-relation', holder: 'B-1', field: 'requires', target: 'B-1' })).error).toContain("can't requires itself");
    expect((await run({ kind: 'remove-relation', holder: 'B-7', field: 'serves', target: 'FP-1' })).error).toContain('no serves link');
  });

  it('writes the serves a requires implies: the prerequisite serves what requires it', async () => {
    const { plan, graph: g } = await run({ kind: 'add-relation', holder: 'B-8', field: 'requires', target: 'B-7' });
    expect(edge(g, 'requires:B-8>B-7')).toBe(true);
    expect(edge(g, 'serves:B-7>B-8')).toBe(true);
    expect(plan!.notice).toBe('B-8 requires B-7, so B-7 serves B-8.');
    // Removing the requires leaves the serves: it may have been there on its own.
    const removed = await run({ kind: 'remove-relation', holder: 'B-8', field: 'requires', target: 'B-7' });
    expect(edge(removed.graph, 'requires:B-8>B-7')).toBe(false);
    expect(edge(removed.graph, 'serves:B-7>B-8')).toBe(true);
  });

  it('does not write a serves that is already there', async () => {
    await run({ kind: 'add-relation', holder: 'B-7', field: 'serves', target: 'B-8' });
    const { plan } = await run({ kind: 'add-relation', holder: 'B-8', field: 'requires', target: 'B-7' });
    expect(plan!.writes).toHaveLength(1);
    expect(plan!.notice).toBe('B-8 requires B-7.');
  });

  it('lets milestones and fixed points require, and writes serves only where a serves may go', async () => {
    let { graph: g } = await run({ kind: 'new-milestone', form: { title: 'Kiln paid off', description: '' }, serves: ['FP-2'] });
    ({ graph: g } = await run({ kind: 'add-relation', holder: 'FP-1', field: 'requires', target: 'B-7' }));
    expect(edge(g, 'requires:FP-1>B-7') && edge(g, 'serves:B-7>FP-1')).toBe(true);
    ({ graph: g } = await run({ kind: 'add-relation', holder: 'M-1', field: 'requires', target: 'B-8' }));
    expect(edge(g, 'requires:M-1>B-8') && edge(g, 'serves:B-8>M-1')).toBe(true);
    // A milestone can't serve a bet: requiring one writes the requires alone.
    const { plan, graph: after } = await run({ kind: 'add-relation', holder: 'B-7', field: 'requires', target: 'M-1' });
    expect(plan!.writes).toHaveLength(1);
    expect(edge(after, 'requires:B-7>M-1')).toBe(true);
    expect(after.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual(g.issues.filter((i) => i.severity === 'error').map((i) => i.message));
  });
});

describe('log', () => {
  it('appends a dated line under ## Log and nothing else', async () => {
    const before = vault.files[B1];
    await run({ kind: 'log', key: 'B-1', text: 'on track' });
    expect(vault.files[B1]).toBe(before.replace('- 2026-07-05: created\n', '- 2026-07-05: created\n- 2026-10-04: on track\n'));
    expect((await run({ kind: 'log', key: 'B-1', text: '  ' })).error).toContain('needs some text');
  });
});

describe('kill → activate next', () => {
  it('kills the bet, activates its dormant sequel and logs in both notes, in one plan', async () => {
    const { plan, graph: g } = await run({ kind: 'kill-activate-next', key: 'B-1' });
    expect(plan!.writes).toHaveLength(4);
    expect(node(g, 'B-1').status).toBe('killed');
    expect(node(g, 'B-2').status).toBe('active');
    expect(vault.files[B1]).toContain('- 2026-10-04: Killed. Activating [[B-2 Apply for a digital nomad visa]].');
    expect(vault.files[B2]).toContain('- 2026-10-04: Activated: [[B-1 Get a D7 visa]] was killed.');
  });

  it('refuses without a sequel, with a sequel that is not dormant, and on a closed bet', async () => {
    expect((await run({ kind: 'kill-activate-next', key: 'B-3' })).error).toContain('no next sequel');
    await run({ kind: 'set-status', key: 'B-2', status: 'active' });
    expect((await run({ kind: 'kill-activate-next', key: 'B-1' })).error).toContain('only a dormant sequel');
    expect((await run({ kind: 'kill-activate-next', key: 'B-5' })).error).toContain('already won');
    expect((await run({ kind: 'kill-activate-next', key: 'A-1' })).error).toContain('only a bet');
  });
});

describe('falsify', () => {
  it('falsifies, logs, and the bets leaning on it are flagged by their smells', async () => {
    const { plan, graph: g } = await run({ kind: 'falsify', key: 'A-1' });
    expect(node(g, 'A-1').status).toBe('falsified');
    expect(vault.files['Strategy/Assumptions/A-1 D7 accepts freelance income.md']).toContain('- 2026-10-04: Falsified.');
    expect(plan!.notice).toContain('B-1 is active and depends on it');
    const smells = findSmells(g, { today: TODAY }).filter((s) => s.code === 'falsified-dependency' && s.related.includes('A-1'));
    expect(smells.map((s) => s.node)).toEqual(['B-1']);
  });

  it('refuses on a bet', async () => {
    expect((await run({ kind: 'falsify', key: 'B-1' })).error).toContain('only an assumption');
  });
});

describe('creating from the graph', () => {
  it('creates a bet serving a note, without opening it', async () => {
    const { plan, graph: g } = await run({ kind: 'new-bet', form: { title: 'Open an Etsy shop', x: '', y: '', z: '', deadline: '' }, serves: ['B-4'] });
    expect(plan!.open).toBeNull();
    const created = g.nodes.find((n) => n.basename === 'B-9 Open an Etsy shop')!;
    expect(created).toMatchObject({ id: 'B-9', type: 'bet', status: 'active' });
    expect(edge(g, 'serves:B-9>B-4')).toBe(true);
  });

  it('creates a sequel: the source gets it as next, and the sequel inherits what the source serves', async () => {
    await run({ kind: 'remove-relation', holder: 'B-1', field: 'next', target: 'B-2' });
    const { graph: g } = await run({ kind: 'new-bet', form: { title: 'Plan B for the visa', x: 'x', y: 'y', z: 'z', deadline: '2027-01-01' }, serves: [], sequelOf: 'B-1' });
    expect(edge(g, 'next:B-1>B-9')).toBe(true);
    expect(edge(g, 'serves:B-9>FP-1')).toBe(true);
    // A sequel waits: dormant, so that killing B-1 can activate it.
    expect(node(g, 'B-9').status).toBe('dormant');
    const killed = await run({ kind: 'kill-activate-next', key: 'B-1' });
    expect(killed.error).toBeUndefined();
    expect(node(killed.graph, 'B-9').status).toBe('active');
  });

  it('a bet that is not a sequel starts active', async () => {
    const { graph: g } = await run({ kind: 'new-bet', form: { title: 'Plain', x: '', y: '', z: '', deadline: '' }, serves: [] });
    expect(node(g, 'B-9').status).toBe('active');
  });

  it('refuses a deadline or verify-by that is not a date, before anything is created', async () => {
    const files = { ...vault.files };
    expect((await run({ kind: 'new-bet', form: { title: 'T', x: '', y: '', z: '', deadline: '2027-01-01 # x' }, serves: [] })).error).toContain('is not a date');
    expect((await run({ kind: 'new-assumption', form: { statement: 'S', falsifier: '', verifyBy: 'a: b' }, dependents: [] })).error).toContain('is not a date');
    expect(vault.files).toEqual(files);
  });

  it('refuses a second sequel and creates nothing', async () => {
    const files = { ...vault.files };
    const { error } = await run({ kind: 'new-bet', form: { title: 'T', x: '', y: '', z: '', deadline: '' }, serves: [], sequelOf: 'B-1' });
    expect(error).toContain('already has a next sequel');
    expect(vault.files).toEqual(files);
  });

  it('creates an assumption that notes lean on, and links it from each', async () => {
    const { graph: g } = await run({
      kind: 'new-assumption',
      form: { statement: 'Etsy fees stay under ten percent', falsifier: 'Fees go up', verifyBy: '' },
      dependents: ['B-3', 'FP-2'],
    });
    const created = g.nodes.find((n) => n.id === 'A-8')!;
    expect(created.type).toBe('assumption');
    expect(edge(g, 'assumption:B-3>A-8')).toBe(true);
    expect(edge(g, 'assumption:FP-2>A-8')).toBe(true);
    expect(vault.files[B3]).toContain('[[A-8 Etsy fees stay under ten percent]]');
  });
});

describe('creating a milestone, and what a creation reports (Phase 7)', () => {
  it('creates an open milestone serving a fixed point, and reports the id and path it made', async () => {
    const { plan, graph: g } = await run({ kind: 'new-milestone', form: { title: 'Visa in hand', description: 'The D7 card is issued' }, serves: ['FP-1'] });
    expect(plan!.open).toBeNull();
    expect(plan!.created).toEqual({ id: 'M-1', path: 'Strategy/Milestones/M-1 Visa in hand.md' });
    expect(node(g, 'M-1')).toMatchObject({ type: 'milestone', status: 'open' });
    expect(edge(g, 'serves:M-1>FP-1')).toBe(true);
  });

  it('refuses a milestone that serves a bet, and an empty title', async () => {
    expect((await run({ kind: 'new-milestone', form: { title: 'X', description: '' }, serves: ['B-1'] })).error).toContain('"Serves" must be notes in');
    expect((await run({ kind: 'new-milestone', form: { title: '???', description: '' }, serves: [] })).error).toContain('title is empty');
  });

  it('reports the id of a created bet and assumption', async () => {
    expect((await run({ kind: 'new-bet', form: { title: 'T', x: '', y: '', z: '', deadline: '' }, serves: [] })).plan!.created).toEqual({ id: 'B-9', path: 'Strategy/Bets/B-9 T.md' });
    expect((await run({ kind: 'new-assumption', form: { statement: 'S', falsifier: '', verifyBy: '' }, dependents: [] })).plan!.created!.id).toBe('A-8');
  });
});

describe('relationCandidates', () => {
  it('offers what the types allow: a bet to a fixed point serves it, or the fixed point requires it', async () => {
    const g = await graph();
    const options = relationCandidates(g, 'B-7', 'FP-1');
    expect(options.map((o) => o.label)).toEqual(['B-7 serves FP-1', 'B-7 ultimately serves FP-1', 'FP-1 requires B-7']);
    // `ultimately-serves` is a far anchor, and a fixed point may require a bet: still offered, so the menu asks.
  });

  it('asks when bet to bet is ambiguous: serves, requires, next', async () => {
    const options = relationCandidates(await graph(), 'B-7', 'B-8');
    expect(options.map((o) => `${o.holder}.${o.field}>${o.target}`)).toEqual(['B-7.serves>B-8', 'B-8.requires>B-7', 'B-7.next>B-8']);
  });

  it('reads an assumption dragged either way, and marks what is already there', async () => {
    const g = await graph();
    expect(relationCandidates(g, 'A-7', 'B-7').map((o) => o.label)).toEqual(['B-7 depends on A-7']);
    expect(relationCandidates(g, 'B-7', 'A-7').map((o) => o.label)).toEqual(['B-7 depends on A-7']);
    const existing = relationCandidates(g, 'A-1', 'B-1');
    expect(existing).toHaveLength(1);
    expect(existing[0].blocked).toContain('already');
  });

  it('offers nothing for two fixed points, a note and itself, or an unknown key', async () => {
    const g = await graph();
    expect(relationCandidates(g, 'FP-1', 'FP-2')).toEqual([]);
    expect(relationCandidates(g, 'B-1', 'B-1')).toEqual([]);
    expect(relationCandidates(g, 'B-1', 'nope')).toEqual([]);
  });
});
