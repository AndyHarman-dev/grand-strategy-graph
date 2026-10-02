import { describe, expect, it } from 'vitest';
import { addLinkToField, planAssumption, planBet, planMilestone, planRoute } from '../../src/core/actions';
import { getFilesInFolders } from '../../src/core/plan';
import { FakeVault, readTestVault, testVault } from '../support/fake-app';
import { json } from '../support/serialize';

const TODAY = '2026-10-01';

describe('write plans over the test vault (schema v2)', () => {
  it('getFilesInFolders lists strategy notes sorted by basename', async () => {
    const vault = testVault();
    const listing = {
      fixedPointsAndBets: getFilesInFolders(vault, ['Strategy/Fixed Points', 'Strategy/Bets']).map((f) => f.path),
      assumptions: getFilesInFolders(vault, ['Strategy/Assumptions']).map((f) => f.path),
      // A prefix that is not followed by "/" must not match.
      noTrailingSlashMatch: getFilesInFolders(vault, ['Strategy/Bet']).map((f) => f.path),
    };
    await expect(json(listing)).toMatchFileSnapshot('__golden__/plans/get-files-in-folders.json');
  });

  it('bet plan with new, reused and duplicate assumption rows, and every optional relation', async () => {
    const vault = testVault();
    const data = {
      title: 'Open a pop-up shop',
      x: 'renting a market corner on weekends',
      y: 'a pop-up shop that breaks even',
      z: 'six months',
      deadline: '2027-04-01',
      servesFiles: [vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md'), vault.file('Strategy/Bets/B-7  Part-time barista job.md')],
      ultimatelyServesFiles: [vault.file('Strategy/Fixed Points/FP-1 Live in Portugal.md')],
      requiresFiles: [vault.file('Strategy/Bets/B-3 Sell pottery at weekend markets.md')],
      nextFile: vault.file('Strategy/Bets/B-4 Save 20000 for kiln and lease.md'),
      assumptionRows: [
        { id: 1, mode: 'new', statement: '  Footfall on weekends is high enough.  ', falsifier: ' Under 100 visitors a day ', verifyBy: '2026-11-30', existingFile: null },
        { id: 2, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
        { id: 3, mode: 'new', statement: 'A rather long statement that goes well beyond the sixty character budget for titles', falsifier: '', verifyBy: '', existingFile: null },
        { id: 4, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
        { id: 5, mode: 'new', statement: '###', falsifier: '', verifyBy: '', existingFile: null },
        { id: 6, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') },
      ],
    };
    await expect(json(planBet(vault, data as any, TODAY))).toMatchFileSnapshot('__golden__/plans/bet-plan-mixed.json');
  });

  it('bet plan with no serves and no assumptions', async () => {
    const data = { title: 'Solo', x: 'a', y: 'b', z: 'c', deadline: '', servesFiles: [], assumptionRows: [] };
    await expect(json(planBet(testVault(), data, TODAY))).toMatchFileSnapshot('__golden__/plans/bet-plan-bare.json');
  });

  it('bet plan in an empty vault starts at B-1 / A-1', async () => {
    const data = {
      title: 'First / bet: ever',
      x: 'a',
      y: 'b',
      z: 'c',
      deadline: '',
      servesFiles: [],
      assumptionRows: [{ id: 1, mode: 'new' as const, statement: 'First assumption', falsifier: '', verifyBy: '', existingFile: null }],
    };
    await expect(json(planBet(new FakeVault(), data, TODAY))).toMatchFileSnapshot('__golden__/plans/bet-plan-empty-vault.json');
  });

  it('bet plan refusals', async () => {
    const base = { x: 'a', y: 'b', z: 'c', deadline: '', servesFiles: [], assumptionRows: [] };
    const withExtra = (extra: Record<string, string>, folders: string[] = []) => new FakeVault({ ...readTestVault(), ...extra }, folders);
    const vault = testVault();

    const refusals = {
      duplicateBetIds: planBet(withExtra({ 'Strategy/Bets/B-3 Duplicate.md': '', 'Strategy/Bets/old/B-1 Again.md': '' }), { ...base, title: 'T' }, TODAY),
      duplicateAssumptionIds: planBet(withExtra({ 'Strategy/Assumptions/A-2 Duplicate.md': '' }), { ...base, title: 'T' }, TODAY),
      invalidIds: planBet(
        withExtra({ 'Strategy/Bets/B-99999999999999999999 Huge.md': '', 'Strategy/Assumptions/A-99999999999999999999 Huge.md': '' }),
        { ...base, title: 'T' },
        TODAY
      ),
      emptyTitleAfterSanitize: planBet(testVault(), { ...base, title: '#[]|' }, TODAY),
      betPathTaken: planBet(withExtra({}, ['Strategy/Bets/B-9 Taken.md']), { ...base, title: 'Taken' }, TODAY),
      assumptionPathTaken: planBet(
        withExtra({}, ['Strategy/Assumptions/A-8 Taken.md']),
        { ...base, title: 'T', assumptionRows: [{ id: 1, mode: 'new', statement: 'Taken', falsifier: '', verifyBy: '', existingFile: null }] },
        TODAY
      ),
      // The relation table decides what each field may point at.
      ultimatelyServesABet: planBet(vault, { ...base, title: 'T', ultimatelyServesFiles: [vault.file('Strategy/Bets/B-1 Get a D7 visa.md')] }, TODAY),
      requiresAFixedPoint: planBet(vault, { ...base, title: 'T', requiresFiles: [vault.file('Strategy/Fixed Points/FP-1 Live in Portugal.md')] }, TODAY),
      nextAnAssumption: planBet(vault, { ...base, title: 'T', nextFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') }, TODAY),
      servesAnAssumption: planBet(vault, { ...base, title: 'T', servesFiles: [vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md')] }, TODAY),
      existingAssumptionIsABet: planBet(
        vault,
        { ...base, title: 'T', assumptionRows: [{ id: 1, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Bets/B-1 Get a D7 visa.md') }] },
        TODAY
      ),
    };
    await expect(json(refusals)).toMatchFileSnapshot('__golden__/plans/bet-plan-refusals.json');
  });

  it('assumption plan adds itself to existing notes (deduplicated, any holder type)', async () => {
    const vault = testVault();
    const b3 = vault.file('Strategy/Bets/B-3 Sell pottery at weekend markets.md');
    const data = {
      statement: 'Ceramics fairs accept newcomers.',
      falsifier: 'Rejected by three fairs',
      verifyBy: '2027-02-01',
      dependentFiles: [b3, vault.file('Strategy/Bets/B-7  Part-time barista job.md'), vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md'), b3],
    };
    await expect(json(planAssumption(vault, data, TODAY))).toMatchFileSnapshot('__golden__/plans/assumption-plan-linked.json');
  });

  it('assumption plan refusals and fallbacks', async () => {
    const vault = testVault();
    const none = { falsifier: '', verifyBy: '', dependentFiles: [] };
    const results = {
      noDependentsFallbackTitle: planAssumption(testVault(), { ...none, statement: '|||' }, TODAY),
      duplicateIds: planAssumption(new FakeVault({ ...readTestVault(), 'Strategy/Assumptions/A-1 Again.md': '' }), { ...none, statement: 'S' }, TODAY),
      invalidIds: planAssumption(new FakeVault({ 'Strategy/Assumptions/A-99999999999999999999 Huge.md': '' }), { ...none, statement: 'S' }, TODAY),
      pathTaken: planAssumption(new FakeVault(readTestVault(), ['Strategy/Assumptions/A-8 S.md']), { ...none, statement: 'S' }, TODAY),
      dependentIsAnAssumption: planAssumption(vault, { ...none, statement: 'S', dependentFiles: [vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md')] }, TODAY),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/plans/assumption-plan-refusals.json');
  });

  it('route, ghost route and milestone plans', async () => {
    const vault = testVault();
    const fp1 = vault.file('Strategy/Fixed Points/FP-1 Live in Portugal.md');
    const withRoute = new FakeVault({ ...readTestVault(), 'Strategy/Routes/R-4 Existing.md': '', 'Strategy/Milestones/M-2 Existing.md': '' });
    const results = {
      route: planRoute(vault, { ghost: false, title: 'Study → H1B', description: ' US study path ', servesFiles: [fp1, fp1] }, TODAY),
      ghostRoute: planRoute(vault, { ghost: true, title: 'O1 visa?', description: '', servesFiles: [fp1] }, TODAY),
      milestone: planMilestone(vault, { title: 'First workshop held', description: '', servesFiles: [vault.file('Strategy/Bets/B-8 Teach pottery workshops.md')] }, TODAY),
      nextIdsAfterExisting: [
        planRoute(withRoute, { ghost: false, title: 'Next', description: '', servesFiles: [] }, TODAY),
        planMilestone(withRoute, { title: 'Next', description: '', servesFiles: [] }, TODAY),
      ],
      emptyVault: planRoute(new FakeVault(), { ghost: false, title: 'First', description: '', servesFiles: [] }, TODAY),
      emptyTitle: planRoute(vault, { ghost: false, title: '#[]', description: '', servesFiles: [] }, TODAY),
      servesAnAssumption: planMilestone(vault, { title: 'T', description: '', servesFiles: [vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md')] }, TODAY),
      pathTaken: planRoute(new FakeVault({}, ['Strategy/Routes/R-1 Taken.md']), { ghost: false, title: 'Taken', description: '', servesFiles: [] }, TODAY),
      duplicateIds: planRoute(new FakeVault({ 'Strategy/Routes/R-1 A.md': '', 'Strategy/Routes/R-1 B.md': '' }), { ghost: false, title: 'T', description: '', servesFiles: [] }, TODAY),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/plans/route-milestone-plans.json');
  });
});

describe('addLinkToField', () => {
  const link = '[[A-8 New]]';
  it.each([
    ['nothing', undefined, [link]],
    ['null', null, [link]],
    ['empty string', '', [link]],
    ['empty list', [], [link]],
    ['a list', ['[[A-1 One]]'], ['[[A-1 One]]', link]],
    ['a scalar', '[[A-1 One]]', ['[[A-1 One]]', link]],
  ])('appends to %s', (_name, value, expected) => {
    expect(addLinkToField(value, link)).toEqual(expected);
  });

  it.each([
    ['the same link', ['[[A-8 New]]']],
    ['the same link as a scalar', '[[A-8 New]]'],
    ['an aliased link', ['[[A-8 New|alias]]']],
    ['a different case', ['[[a-8 new]]']],
    ['a heading link', ['[[A-8 New#Log]]']],
  ])('leaves %s alone (same value back, so nothing is written)', (_name, value) => {
    expect(addLinkToField(value, link)).toBe(value);
  });
});
