import { describe, expect, it } from 'vitest';
import { findSmells } from '../../src/core/smells';
import { graphOf, md, migratedTestVault } from '../support/v2';

const smellsOf = async (files: Record<string, string>, today = '2026-10-01') => findSmells(await graphOf(files), { today });
const brief = (smells: Awaited<ReturnType<typeof smellsOf>>) => smells.map((s) => `${s.code} ${s.node}`);

/** Minimal vault: one fixed point plus whatever notes the case adds. */
const vault = (extra: Record<string, string>): Record<string, string> => ({
  'Strategy/FP-1.md': md({ id: 'FP-1', type: 'fixed-point' }),
  ...extra,
});
const bet = (id: string, fm: Record<string, unknown> = {}) => ({
  [`Strategy/${id}.md`]: md({ id, type: 'bet', status: 'active', serves: ['[[FP-1]]'], ...fm }),
});
const milestone = (id: string, fm: Record<string, unknown> = {}) => ({
  [`Strategy/${id}.md`]: md({ id, type: 'milestone', status: 'open', serves: ['[[FP-1]]'], ...fm }),
});
const assumption = (id: string, fm: Record<string, unknown> = {}) => ({
  [`Strategy/${id}.md`]: md({ id, type: 'assumption', status: 'unverified', 'verify-by': '2026-12-01', ...fm }),
});

describe('findSmells over the migrated test vault', () => {
  it('finds exactly the smells the fixture was built with', async () => {
    const smells = await smellsOf(migratedTestVault(), '2026-10-20');
    expect(brief(smells)).toEqual([
      'falsified-dependency B-3', // A-3 falsified, B-3 active
      'gating-violation B-1', // A-2 unverified with no verify-by
      'gating-violation B-4', // same A-2
      'dormant-not-next B-8',
      'overdue-bet B-3', // deadline 2026-10-15
      'orphan-bet B-7', // no serves
    ].sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1]) || a.localeCompare(b)));
    expect(smells.find((s) => s.node === 'B-4' && s.code === 'gating-violation')?.related).toEqual(['A-2']);
    expect(smells.find((s) => s.code === 'falsified-dependency')?.related).toEqual(['A-3']);
  });

  it('flags nothing overdue before the deadline, nor on it', async () => {
    expect((await smellsOf(migratedTestVault(), '2026-10-15')).map((s) => s.code)).not.toContain('overdue-bet');
    expect((await smellsOf(migratedTestVault(), '2026-10-16')).map((s) => s.code)).toContain('overdue-bet');
  });
});

describe('orphan-bet', () => {
  it('follows serves chains through bets and milestones', async () => {
    const smells = await smellsOf(vault({
      ...bet('B-1'),
      ...bet('B-2', { serves: ['[[B-1]]'] }),
      ...milestone('M-2'),
      ...milestone('M-1', { serves: ['[[M-2]]'] }),
      ...bet('B-3', { serves: ['[[M-1]]'] }),
    }));
    expect(brief(smells)).toEqual([]);
  });

  it('flags a bet whose chain ends short of a fixed point, and one with no serves', async () => {
    const smells = await smellsOf(vault({
      ...bet('B-1', { serves: null }),
      ...bet('B-2', { serves: ['[[B-1]]'] }),
      ...bet('B-3', { serves: null, 'ultimately-serves': ['[[FP-1]]'] }),
    }));
    expect(brief(smells)).toEqual(['orphan-bet B-1', 'orphan-bet B-2', 'orphan-bet B-3', 'unreached-fixed-point FP-1']);
  });

  it('flags a bet whose chain dead-ends at a milestone that serves nothing', async () => {
    const smells = await smellsOf(vault({
      ...milestone('M-1', { serves: null }),
      ...milestone('M-2', { serves: ['[[M-1]]'] }),
      ...bet('B-1', { serves: ['[[M-1]]'] }),
      ...bet('B-2', { serves: ['[[M-2]]'] }),
    }));
    expect(brief(smells)).toEqual(['orphan-bet B-1', 'orphan-bet B-2', 'unreached-fixed-point FP-1']);
  });

  it('does not count `requires` as a chain: starting from a milestone is not serving it', async () => {
    const smells = await smellsOf(vault({ ...milestone('M-1', { status: 'reached' }), ...bet('B-1', { serves: null, requires: ['[[M-1]]'] }) }));
    expect(brief(smells)).toEqual(['orphan-bet B-1']);
  });

  it('terminates on a serves cycle', async () => {
    const smells = await smellsOf(vault({
      ...bet('B-1', { serves: ['[[B-2]]'] }),
      ...bet('B-2', { serves: ['[[B-1]]'] }),
    }));
    expect(brief(smells)).toEqual(['orphan-bet B-1', 'orphan-bet B-2', 'unreached-fixed-point FP-1']);
  });
});

describe('unreached-fixed-point', () => {
  it('flags a fixed point nothing serves', async () => {
    const smells = await smellsOf(vault({ 'Strategy/FP-2.md': md({ id: 'FP-2', type: 'fixed-point' }), ...bet('B-1') }));
    expect(brief(smells)).toEqual(['unreached-fixed-point FP-2']);
  });

  it('is satisfied by a milestone that serves it', async () => {
    const smells = await smellsOf(vault(milestone('M-1')));
    expect(brief(smells)).toEqual([]);
  });
});

describe('gating-violation and falsified-dependency', () => {
  it('flags an active bet on an unverified assumption without verify-by', async () => {
    const smells = await smellsOf(vault({ ...bet('B-1', { assumptions: ['[[A-1]]'] }), ...assumption('A-1', { 'verify-by': null }) }));
    expect(brief(smells)).toEqual(['gating-violation B-1']);
  });

  it('accepts a verify-by date, and any other assumption status', async () => {
    const smells = await smellsOf(vault({
      ...bet('B-1', { assumptions: ['[[A-1]]', '[[A-2]]', '[[A-3]]'] }),
      ...assumption('A-1'),
      ...assumption('A-2', { status: 'confirmed', 'verify-by': null }),
      ...assumption('A-3', { status: 'undeterminable', 'verify-by': null }),
    }));
    expect(brief(smells)).toEqual([]);
  });

  it('flags an active bet on a falsified assumption', async () => {
    const smells = await smellsOf(vault({ ...bet('B-1', { assumptions: ['[[A-1]]'] }), ...assumption('A-1', { status: 'falsified' }) }));
    expect(brief(smells)).toEqual(['falsified-dependency B-1']);
  });

  it('ignores bets that are not active', async () => {
    const smells = await smellsOf(vault({
      ...bet('B-1', { status: 'won', assumptions: ['[[A-1]]'] }),
      ...bet('B-2', { status: 'killed', assumptions: ['[[A-2]]'] }),
      ...assumption('A-1', { status: 'falsified' }),
      ...assumption('A-2', { 'verify-by': null }),
    }));
    expect(brief(smells)).toEqual([]);
  });

  it('does not flag fixed points that lean on a falsified assumption', async () => {
    const smells = await smellsOf({
      'Strategy/FP-1.md': md({ id: 'FP-1', type: 'fixed-point', assumptions: ['[[A-1]]'] }),
      ...bet('B-1'),
      ...assumption('A-1', { status: 'falsified' }),
    });
    expect(brief(smells)).toEqual([]);
  });
});

describe('overdue-bet', () => {
  it('flags only active bets with a past deadline', async () => {
    const smells = await smellsOf(vault({
      ...bet('B-1', { deadline: '2026-09-30' }),
      ...bet('B-2', { deadline: '2026-10-01' }),
      ...bet('B-3', { deadline: '2026-09-01', status: 'won' }),
      ...bet('B-4', { deadline: null }),
      ...bet('B-5', { deadline: 'soon' }),
      ...bet('B-6', { deadline: '2026-09-30T08:00:00' }),
    }));
    expect(brief(smells)).toEqual(['overdue-bet B-1', 'overdue-bet B-6']);
  });
});

describe('dormant-not-next', () => {
  it('flags a dormant bet that no bet names as next', async () => {
    const smells = await smellsOf(vault({ ...bet('B-1', { status: 'dormant' }), ...bet('B-2', { next: '[[B-1]]' }), ...bet('B-3', { status: 'dormant' }) }));
    expect(brief(smells)).toEqual(['dormant-not-next B-3']);
  });
});

describe('requires-open-milestone', () => {
  it('flags an active bet that requires a milestone still open, naming the milestones', async () => {
    const smells = await smellsOf(vault({
      ...milestone('M-1'),
      ...milestone('M-2', { status: 'reached' }),
      ...milestone('M-3'),
      ...bet('B-1', { serves: ['[[M-1]]'] }),
      ...bet('B-2', { requires: ['[[M-1]]', '[[M-2]]', '[[M-3]]', '[[B-1]]'] }),
    }));
    expect(brief(smells)).toEqual(['requires-open-milestone B-2']);
    expect(smells[0].related).toEqual(['M-1', 'M-3']);
  });

  it('accepts a reached milestone, a required bet, and a bet that is not active', async () => {
    const smells = await smellsOf(vault({
      ...milestone('M-1'),
      ...milestone('M-2', { status: 'reached' }),
      ...bet('B-1', { requires: ['[[M-2]]'] }),
      ...bet('B-2', { requires: ['[[B-1]]'] }),
      ...bet('B-3', { status: 'dormant', requires: ['[[M-1]]'] }),
      ...bet('B-4', { next: '[[B-3]]', serves: ['[[M-1]]'] }),
    }));
    expect(brief(smells)).toEqual([]);
  });

  it('ignores a milestone with a status that is not `open` (the graph reports it instead)', async () => {
    const smells = await smellsOf(vault({ ...milestone('M-1', { status: 'someday' }), ...bet('B-1', { requires: ['[[M-1]]'] }) }));
    expect(brief(smells)).toEqual([]);
  });

  it('only counts milestones: a required bet with a stray `status: open` is not one', async () => {
    const smells = await smellsOf(vault({ ...bet('B-1', { status: 'open' }), ...bet('B-2', { requires: ['[[B-1]]'] }) }));
    expect(brief(smells)).toEqual([]);
  });
});
