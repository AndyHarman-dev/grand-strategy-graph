import { describe, expect, it } from 'vitest';
import { FakeVault, makeApp, readTestVault, testVault } from '../support/fake-app';
import { implementations } from '../support/impls';
import { json } from '../support/serialize';

const TODAY = '2026-10-01';

describe.each(implementations)('write plans over the test vault ($name)', (impl) => {
  it('getFilesInFolders lists strategy notes sorted by basename', async () => {
    const app = makeApp(testVault());
    const listing = {
      fixedPointsAndBets: impl.getFilesInFolders(app, ['Strategy/Fixed Points', 'Strategy/Bets']).map((f) => f.path),
      assumptions: impl.getFilesInFolders(app, ['Strategy/Assumptions']).map((f) => f.path),
      // A prefix that is not followed by "/" must not match.
      noTrailingSlashMatch: impl.getFilesInFolders(app, ['Strategy/Bet']).map((f) => f.path),
    };
    await expect(json(listing)).toMatchFileSnapshot('__golden__/plans/get-files-in-folders.json');
  });

  it('bet plan with new, reused and duplicate assumption rows', async () => {
    const vault = testVault();
    const app = makeApp(vault);
    const data = {
      title: 'Open a pop-up shop',
      x: 'renting a market corner on weekends',
      y: 'a pop-up shop that breaks even',
      z: 'six months',
      deadline: '2027-04-01',
      servesFiles: [vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md'), vault.file('Strategy/Bets/B-7  Part-time barista job.md')],
      assumptionRows: [
        { id: 1, mode: 'new', statement: '  Footfall on weekends is high enough.  ', falsifier: ' Under 100 visitors a day ', verifyBy: '2026-11-30', existingFile: null },
        { id: 2, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
        { id: 3, mode: 'new', statement: 'A rather long statement that goes well beyond the sixty character budget for titles', falsifier: '', verifyBy: '', existingFile: null },
        { id: 4, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
        { id: 5, mode: 'new', statement: '###', falsifier: '', verifyBy: '', existingFile: null },
        { id: 6, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') },
      ],
    };
    await expect(json(impl.buildWritePlan(app, data, TODAY))).toMatchFileSnapshot('__golden__/plans/bet-plan-mixed.json');
  });

  it('bet plan with no serves and no assumptions', async () => {
    const app = makeApp(testVault());
    const data = { title: 'Solo', x: 'a', y: 'b', z: 'c', deadline: '', servesFiles: [], assumptionRows: [] };
    await expect(json(impl.buildWritePlan(app, data, TODAY))).toMatchFileSnapshot('__golden__/plans/bet-plan-bare.json');
  });

  it('bet plan in an empty vault starts at B-1 / A-1', async () => {
    const app = makeApp(new FakeVault());
    const data = {
      title: 'First / bet: ever',
      x: 'a',
      y: 'b',
      z: 'c',
      deadline: '',
      servesFiles: [],
      assumptionRows: [{ id: 1, mode: 'new', statement: 'First assumption', falsifier: '', verifyBy: '', existingFile: null }],
    };
    await expect(json(impl.buildWritePlan(app, data, TODAY))).toMatchFileSnapshot('__golden__/plans/bet-plan-empty-vault.json');
  });

  it('bet plan refusals', async () => {
    const base = { x: 'a', y: 'b', z: 'c', deadline: '', servesFiles: [], assumptionRows: [] };
    const withExtra = (extra: Record<string, string>, folders: string[] = []) =>
      makeApp(new FakeVault({ ...readTestVault(), ...extra }, folders));

    const refusals = {
      duplicateBetIds: impl.buildWritePlan(withExtra({ 'Strategy/Bets/B-3 Duplicate.md': '', 'Strategy/Bets/old/B-1 Again.md': '' }), { ...base, title: 'T' }, TODAY),
      duplicateAssumptionIds: impl.buildWritePlan(withExtra({ 'Strategy/Assumptions/A-2 Duplicate.md': '' }), { ...base, title: 'T' }, TODAY),
      invalidIds: impl.buildWritePlan(
        withExtra({ 'Strategy/Bets/B-99999999999999999999 Huge.md': '', 'Strategy/Assumptions/A-99999999999999999999 Huge.md': '' }),
        { ...base, title: 'T' },
        TODAY
      ),
      emptyTitleAfterSanitize: impl.buildWritePlan(makeApp(testVault()), { ...base, title: '#[]|' }, TODAY),
      betPathTaken: impl.buildWritePlan(withExtra({}, ['Strategy/Bets/B-9 Taken.md']), { ...base, title: 'Taken' }, TODAY),
      assumptionPathTaken: impl.buildWritePlan(
        withExtra({}, ['Strategy/Assumptions/A-8 Taken.md']),
        { ...base, title: 'T', assumptionRows: [{ id: 1, mode: 'new', statement: 'Taken', falsifier: '', verifyBy: '', existingFile: null }] },
        TODAY
      ),
    };
    await expect(json(refusals)).toMatchFileSnapshot('__golden__/plans/bet-plan-refusals.json');
  });

  it('assumption plan linking existing bets (deduplicated)', async () => {
    const vault = testVault();
    const app = makeApp(vault);
    const b3 = vault.file('Strategy/Bets/B-3 Sell pottery at weekend markets.md');
    const data = {
      statement: 'Ceramics fairs accept newcomers.',
      falsifier: 'Rejected by three fairs',
      verifyBy: '2027-02-01',
      betFiles: [b3, vault.file('Strategy/Bets/B-7  Part-time barista job.md'), b3],
    };
    await expect(json(impl.buildAssumptionWritePlan(app, data, TODAY))).toMatchFileSnapshot(
      '__golden__/plans/assumption-plan-linked.json'
    );
  });

  it('assumption plan refusals and fallbacks', async () => {
    const results = {
      noBetsFallbackTitle: impl.buildAssumptionWritePlan(makeApp(testVault()), { statement: '|||', falsifier: '', verifyBy: '', betFiles: [] }, TODAY),
      duplicateIds: impl.buildAssumptionWritePlan(
        makeApp(new FakeVault({ ...readTestVault(), 'Strategy/Assumptions/A-1 Again.md': '' })),
        { statement: 'S', falsifier: '', verifyBy: '', betFiles: [] },
        TODAY
      ),
      invalidIds: impl.buildAssumptionWritePlan(
        makeApp(new FakeVault({ 'Strategy/Assumptions/A-99999999999999999999 Huge.md': '' })),
        { statement: 'S', falsifier: '', verifyBy: '', betFiles: [] },
        TODAY
      ),
      pathTaken: impl.buildAssumptionWritePlan(
        makeApp(new FakeVault(readTestVault(), ['Strategy/Assumptions/A-8 S.md'])),
        { statement: 'S', falsifier: '', verifyBy: '', betFiles: [] },
        TODAY
      ),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/plans/assumption-plan-refusals.json');
  });
});
