import { beforeEach, describe, expect, it } from 'vitest';
import * as create from '../../src/obsidian/create';
import { resetObsidianMock, setToday } from '../mocks/obsidian';
import { FakeVault, makeApp } from '../support/fake-app';
import { graphOf, migratedTestVault } from '../support/v2';

/**
 * What the creation flows write must be valid schema v2 for Phase 1's graph builder: no new
 * issues, and every relation chosen in a form arrives as the edge of its kind.
 */

type Flow = (app: any, data: any) => Promise<void>;
const createBet = create.createBetFromForm as Flow;
const createAssumption = create.createAssumptionFromForm as Flow;
const createMilestone = create.createMilestoneFromForm as Flow;

beforeEach(() => {
  resetObsidianMock();
  setToday('2026-10-01');
});

const edgeKeys = (g: Awaited<ReturnType<typeof graphOf>>) => new Set(g.edges.map((e) => `${e.kind}:${e.from}>${e.to}`));

describe('notes created by the plugin build a clean graph', () => {
  it('bets, assumptions and milestones in a v2 vault: no new issues, every relation is an edge', async () => {
    const before = migratedTestVault();
    const baseline = await graphOf(before);
    const vault = new FakeVault(before);
    const app = makeApp(vault) as any;
    const f = (path: string) => vault.file(path);
    const fp1 = f('Strategy/Fixed Points/FP-1 Live in Portugal.md');
    const fp2 = f('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md');
    const b3 = f('Strategy/Bets/B-3 Sell pottery at weekend markets.md');
    const b4 = f('Strategy/Bets/B-4 Save 20000 for kiln and lease.md');

    await createMilestone(app, { title: 'Residence card in hand', description: '', servesFiles: [fp1] });
    await createMilestone(app, { title: 'First workshop held', description: '', servesFiles: [f('Strategy/Milestones/M-1 Residence card in hand.md'), fp2] });
    await createBet(app, {
      title: 'Open a pop-up shop',
      x: 'renting a corner',
      y: 'a shop that breaks even',
      z: 'six months',
      deadline: '2027-04-01',
      servesFiles: [f('Strategy/Milestones/M-2 First workshop held.md'), b4],
      ultimatelyServesFiles: [fp2],
      requiresFiles: [b3, f('Strategy/Milestones/M-1 Residence card in hand.md')],
      nextFile: b4,
      assumptionRows: [
        { id: 1, mode: 'new', statement: 'Footfall is high enough', falsifier: 'Under 100 a day', verifyBy: '2026-11-30', existingFile: null },
        { id: 2, mode: 'existing', existingFile: f('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
      ],
    });
    // Assumptions can attach to any node type that carries `assumptions`, fixed points and milestones included.
    await createAssumption(app, {
      statement: 'Permits take under a month',
      falsifier: '',
      verifyBy: '2026-12-01',
      dependentFiles: [fp2, f('Strategy/Milestones/M-2 First workshop held.md'), f('Strategy/Bets/B-9 Open a pop-up shop.md')],
    });

    const after = await graphOf(Object.fromEntries(vault.contents));
    const known = new Set(baseline.issues.map((i) => JSON.stringify(i)));
    expect(after.issues.filter((i) => !known.has(JSON.stringify(i)))).toEqual([]);

    const keys = edgeKeys(after);
    for (const edge of [
      'serves:M-1>FP-1',
      'serves:M-2>M-1',
      'serves:M-2>FP-2',
      'serves:B-9>M-2',
      'serves:B-9>B-4',
      'ultimately-serves:B-9>FP-2',
      'requires:B-9>B-3',
      'requires:B-9>M-1',
      'next:B-9>B-4',
      'assumption:B-9>A-4',
      'assumption:B-9>A-8',
      'assumption:FP-2>A-9',
      'assumption:M-2>A-9',
      'assumption:B-9>A-9',
    ]) {
      expect(keys, edge).toContain(edge);
    }
    const byId = new Map(after.nodes.map((n) => [n.id, n]));
    expect(byId.get('B-9')).toMatchObject({ type: 'bet', status: 'active', deadline: '2027-04-01' });
    expect(byId.get('A-9')).toMatchObject({ type: 'assumption', status: 'unverified', verifyBy: '2026-12-01' });
    expect(byId.get('M-1')).toMatchObject({ type: 'milestone', status: 'open' });
    expect(byId.get('M-2')).toMatchObject({ type: 'milestone', status: 'open' });
  });

  it('into an empty vault the first notes still validate (ids start at 1 in every space)', async () => {
    const vault = new FakeVault();
    const app = makeApp(vault) as any;
    await createBet(app, {
      title: 'First',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [{ id: 1, mode: 'new', statement: 'S', falsifier: '', verifyBy: '', existingFile: null }],
    });
    const graph = await graphOf(Object.fromEntries(vault.contents));
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['A-1', 'B-1']);
    expect(graph.edges.map((e) => `${e.kind}:${e.from}>${e.to}`)).toEqual(['assumption:B-1>A-1']);
    // No `serves` yet is the orphan smell's business, not a schema issue.
    expect(graph.issues).toEqual([]);
  });
});
