import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notices, resetObsidianMock, setToday } from '../mocks/obsidian';
import { FakeVault, makeApp, readTestVault, testVault } from '../support/fake-app';
import * as create from '../../src/obsidian/create';
import { json } from '../support/serialize';

// The form data holds FakeFile objects where Obsidian passes TFiles; the app is the fake one too.
type Flow = (app: any, data: any) => Promise<void>;
const createBetFromForm = create.createBetFromForm as Flow;
const createAssumptionFromForm = create.createAssumptionFromForm as Flow;
const createMilestoneFromForm = create.createMilestoneFromForm as Flow;

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

describe('create flows (schema v2)', () => {
  it('create bet with new and reused assumptions', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    await createBetFromForm(makeApp(vault) as any, {
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
    await createBetFromForm(makeApp(vault) as any, {
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
    await createBetFromForm(makeApp(vault) as any, {
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
    await createBetFromForm(makeApp(vault) as any, {
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
    await createBetFromForm(makeApp(vault) as any, {
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
      // No `assumptions` key yet: processFrontMatter adds it.
      'Strategy/Bets/B-9 No assumptions key.md': '---\ntype: bet\nstatus: active\n---\n## The Bet\nText\n',
      // A scalar `assumptions` becomes a list.
      'Strategy/Bets/B-10 Scalar assumptions.md': '---\ntype: bet\nstatus: active\nassumptions: "[[A-2 Rent in Lisbon stays under 1200]]"\n---\n',
      // Already listed: nothing is written.
      'Strategy/Bets/B-11 Already listed.md': '---\ntype: bet\nstatus: active\nassumptions:\n  - "[[A-8 Ceramics fairs accept newcomers]]"\n---\n',
    };
    const vault = new FakeVault(before);
    const b4 = vault.file('Strategy/Bets/B-4 Save 20000 for kiln and lease.md');
    await createAssumptionFromForm(makeApp(vault) as any, {
      statement: 'Ceramics fairs accept newcomers.',
      falsifier: 'Rejected by three fairs',
      verifyBy: '2027-02-01',
      dependentFiles: [
        b4,
        vault.file('Strategy/Bets/B-7  Part-time barista job.md'),
        vault.file('Strategy/Bets/B-9 No assumptions key.md'),
        vault.file('Strategy/Bets/B-10 Scalar assumptions.md'),
        vault.file('Strategy/Bets/B-11 Already listed.md'),
        vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md'),
        b4,
      ],
    });
    await expectFlow('assumption-linked', vault, before);
  });

  it('create milestones: one serving a fixed point, one serving that milestone', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    const app = makeApp(vault) as any;
    const fp2 = vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md');
    await createMilestoneFromForm(app, { title: 'Studio lease signed', description: 'Keys in hand', servesFiles: [fp2] });
    await createMilestoneFromForm(app, { title: 'First workshop held?', description: '', servesFiles: [vault.file('Strategy/Milestones/M-1 Studio lease signed.md')] });
    await expectFlow('milestones', vault, before);
  });

  it('create milestone in an empty vault creates the folder first; a refused plan writes nothing', async () => {
    const vault = new FakeVault();
    await createMilestoneFromForm(makeApp(vault) as any, { title: 'First', description: '', servesFiles: [] });
    await expectFlow('milestone-empty-vault', vault, {});

    const before = { ...readTestVault(), 'Strategy/Milestones/M-1 A.md': '', 'Strategy/Milestones/M-1 B.md': '' };
    const dup = new FakeVault(before);
    await createMilestoneFromForm(makeApp(dup) as any, { title: 'T', description: '', servesFiles: [] });
    await expectFlow('milestone-refused', dup, before);
  });

  it('create assumption reports the notes already written when a link append fails', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    const app = makeApp(vault) as any;
    app.fileManager.processFrontMatter = async () => {
      throw new Error('Simulated frontmatter failure.');
    };
    await createAssumptionFromForm(app, {
      statement: 'S',
      falsifier: '',
      verifyBy: '',
      dependentFiles: [vault.file('Strategy/Bets/B-4 Save 20000 for kiln and lease.md')],
    });
    await expectFlow('assumption-link-failure', vault, before);
  });

  it('never writes into a note body or touches a note it was not asked to change', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    const reused = vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md');
    await createBetFromForm(makeApp(vault) as any, {
      title: 'Reuse only',
      x: 'x',
      y: 'y',
      z: 'z',
      deadline: '',
      servesFiles: [],
      assumptionRows: [{ id: 1, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: reused }],
    });
    // The assumption is not edited at all: the bet's own `assumptions` is the only record of the relation.
    expect(vault.contents.get(reused.path)).toBe(before[reused.path]);
    expect(vault.ops.filter((o) => o.op === 'processFrontMatter')).toEqual([]);
    expect(vault.contents.get('Strategy/Bets/B-9 Reuse only.md')).toContain('assumptions:\n  - "[[A-4 Tourists buy handmade ceramics]]"');
  });

  it('create assumption with no bets in an empty vault', async () => {
    const vault = new FakeVault();
    await createAssumptionFromForm(makeApp(vault) as any, { statement: 'Lonely', falsifier: '', verifyBy: '', dependentFiles: [] });
    await expectFlow('assumption-empty-vault', vault, {});
  });

  it('create assumption aborts on duplicate ids', async () => {
    const before = { ...readTestVault(), 'Strategy/Assumptions/A-3 Duplicate.md': '' };
    const vault = new FakeVault(before);
    await createAssumptionFromForm(makeApp(vault) as any, { statement: 'S', falsifier: '', verifyBy: '', dependentFiles: [] });
    await expectFlow('assumption-refused', vault, before);
  });

  it('create assumption reports a failed write', async () => {
    const before = readTestVault();
    const vault = new FakeVault(before);
    vault.failCreateOn = 'Strategy/Assumptions/A-8 S.md';
    await createAssumptionFromForm(makeApp(vault) as any, { statement: 'S', falsifier: '', verifyBy: '', dependentFiles: [] });
    await expectFlow('assumption-failure', vault, before);
  });

  it('uses the date from moment() for "today"', async () => {
    setToday('2031-02-28');
    const vault = new FakeVault();
    await createAssumptionFromForm(makeApp(vault) as any, { statement: 'Dated', falsifier: '', verifyBy: '', dependentFiles: [] });
    expect(vault.contents.get('Strategy/Assumptions/A-1 Dated.md')).toContain('created: 2031-02-28');
  });

  it('leaves every untouched test-vault file byte-identical', async () => {
    const before = readTestVault();
    const vault = testVault();
    await createBetFromForm(makeApp(vault) as any, {
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
