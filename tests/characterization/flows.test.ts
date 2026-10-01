import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notices, resetObsidianMock, setToday } from '../mocks/obsidian';
import { FakeVault, makeApp, readTestVault, testVault } from '../support/fake-app';
import { implementations, type Impl } from '../support/impls';
import { json } from '../support/serialize';

/**
 * End-to-end create flows against an in-memory copy of test-vault/: the exact
 * write sequence, notices, console output and the bytes of every file that was
 * created or changed. "Byte parity" for Phase 0 is defined by these goldens.
 */

let consoleLog: string[] = [];

beforeEach(() => {
  resetObsidianMock();
  setToday('2026-10-01');
  consoleLog = [];
  const record = (level: string) => (...args: unknown[]) => {
    consoleLog.push(level + ': ' + args.map((a) => (a instanceof Error ? 'Error: ' + a.message : String(a))).join(' '));
  };
  vi.spyOn(console, 'error').mockImplementation(record('error'));
  vi.spyOn(console, 'warn').mockImplementation(record('warn'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectFlow(caseName: string, vault: FakeVault, before: Record<string, string>) {
  const changed: string[] = [];
  for (const [path, content] of vault.contents) {
    if (before[path] !== content) changed.push(path);
  }
  changed.sort();
  for (const path of changed) {
    await expect(vault.contents.get(path)).toMatchFileSnapshot(`__golden__/flows/${caseName}/${path}`);
  }
  await expect(json({ ops: vault.ops, notices, console: consoleLog, changed })).toMatchFileSnapshot(
    `__golden__/flows/${caseName}.json`
  );
}

describe.each(implementations)('create flows ($name)', (impl: Impl) => {
  it('create bet with new and reused assumptions', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    await impl.createBetFromForm(makeApp(vault), {
      title: 'Open a pop-up shop',
      x: 'renting a market corner on weekends',
      y: 'a pop-up shop that breaks even',
      z: 'six months',
      deadline: '2027-04-01',
      servesFiles: [vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md')],
      assumptionRows: [
        { id: 1, mode: 'new', statement: 'Footfall on weekends is high enough.', falsifier: 'Under 100 visitors a day', verifyBy: '2026-11-30', existingFile: null },
        { id: 2, mode: 'new', statement: 'Permits take under a month', falsifier: '', verifyBy: '', existingFile: null },
        // Bullet-less backlink note, no-placeholder note, and an orphan assumption.
        { id: 3, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
        { id: 4, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') },
        { id: 5, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-7 Workshops can fill eight seats.md') },
        { id: 6, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') },
      ],
    });
    await expectFlow('bet-mixed', vault, before);
  });

  it('create bet in an empty vault creates the folders first', async () => {
    const vault = new FakeVault();
    await impl.createBetFromForm(makeApp(vault), {
      title: 'First bet',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [],
    });
    await expectFlow('bet-empty-vault', vault, {});
  });

  it('create bet aborts before writing when the plan is refused', async () => {
    const before = { ...readTestVault(), 'Strategy/Bets/B-1 Duplicate.md': '' };
    const vault = new FakeVault(before);
    await impl.createBetFromForm(makeApp(vault), {
      title: 'T',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [{ id: 1, mode: 'new', statement: 'S', falsifier: '', verifyBy: '', existingFile: null }],
    });
    await expectFlow('bet-refused', vault, before);
  });

  it('create bet reports what was already written when a write fails', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    vault.failCreateOn = 'Strategy/Bets/B-9 Will fail.md';
    await impl.createBetFromForm(makeApp(vault), {
      title: 'Will fail',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [{ id: 1, mode: 'new', statement: 'Gets written', falsifier: '', verifyBy: '', existingFile: null }],
    });
    await expectFlow('bet-partial-failure', vault, before);
  });

  it('create bet failing on the first write says nothing was created', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    vault.failCreateOn = 'Strategy/Bets/B-9 Will fail.md';
    await impl.createBetFromForm(makeApp(vault), {
      title: 'Will fail',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [],
    });
    await expectFlow('bet-failure-nothing-created', vault, before);
  });

  it('create assumption linked to existing bets', async () => {
    const before = {
      ...readTestVault(),
      // A bet with no "Assumptions This Bet Depends On" section gets one appended.
      'Strategy/Bets/B-9 No assumptions section.md': '---\ntype: bet\nstatus: active\n---\n## The Bet\nText\n',
    };
    const vault = new FakeVault(before);
    const b4 = vault.file('Strategy/Bets/B-4 Save 20000 for kiln and lease.md');
    await impl.createAssumptionFromForm(makeApp(vault), {
      statement: 'Ceramics fairs accept newcomers.',
      falsifier: 'Rejected by three fairs',
      verifyBy: '2027-02-01',
      betFiles: [
        b4,
        vault.file('Strategy/Bets/B-7  Part-time barista job.md'),
        vault.file('Strategy/Bets/B-9 No assumptions section.md'),
        b4,
      ],
    });
    await expectFlow('assumption-linked', vault, before);
  });

  it('create assumption with no bets in an empty vault', async () => {
    const vault = new FakeVault();
    await impl.createAssumptionFromForm(makeApp(vault), { statement: 'Lonely', falsifier: '', verifyBy: '', betFiles: [] });
    await expectFlow('assumption-empty-vault', vault, {});
  });

  it('create assumption aborts on duplicate ids', async () => {
    const before = { ...readTestVault(), 'Strategy/Assumptions/A-3 Duplicate.md': '' };
    const vault = new FakeVault(before);
    await impl.createAssumptionFromForm(makeApp(vault), { statement: 'S', falsifier: '', verifyBy: '', betFiles: [] });
    await expectFlow('assumption-refused', vault, before);
  });

  it('create assumption reports a failed write', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    vault.failCreateOn = 'Strategy/Assumptions/A-8 S.md';
    await impl.createAssumptionFromForm(makeApp(vault), { statement: 'S', falsifier: '', verifyBy: '', betFiles: [] });
    await expectFlow('assumption-failure', vault, before);
  });

  it('uses the date from moment() for "today"', async () => {
    setToday('2031-02-28');
    const vault = new FakeVault();
    await impl.createAssumptionFromForm(makeApp(vault), { statement: 'Dated', falsifier: '', verifyBy: '', betFiles: [] });
    expect(vault.contents.get('Strategy/Assumptions/A-1 Dated.md')).toContain('created: 2031-02-28');
  });

  it('leaves every untouched test-vault file byte-identical', async () => {
    const before = readTestVault();
    const vault = testVault();
    await impl.createBetFromForm(makeApp(vault), {
      title: 'Untouched check',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [],
    });
    for (const [path, content] of Object.entries(before)) {
      expect(vault.contents.get(path), path).toBe(content);
    }
  });
});
