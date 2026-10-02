import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOptions } from '../../esbuild.options.mjs';
import * as obsidian from '../mocks/obsidian';
import { notices, openedModals, resetObsidianMock } from '../mocks/obsidian';
import { FakeVault, makeApp, readTestVault } from '../support/fake-app';
import { json } from '../support/serialize';

/**
 * End to end through what Obsidian actually loads: build the production
 * bundle in memory, evaluate it the way Obsidian does (CommonJS, default
 * export), run a command, fill the modal, submit, and compare the resulting
 * vault writes against the same goldens the unit-level flows use.
 */

async function loadBundledPlugin(): Promise<any> {
  const result = await esbuild.build({ ...buildOptions({ production: true }), write: false, logLevel: 'silent' });
  const code = result.outputFiles[0].text;
  const nodeRequire = createRequire(import.meta.url);
  const mod: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id: string) => (id === 'obsidian' ? obsidian : nodeRequire(id)),
    mod,
    mod.exports
  );
  // Obsidian accepts either `module.exports = Plugin` or `exports.default = Plugin`.
  return mod.exports.default ?? mod.exports;
}

const plugins: { name: string; Plugin: any }[] = [];
let consoleLog: string[] = [];

beforeAll(async () => {
  plugins.push({ name: 'bundle', Plugin: await loadBundledPlugin() });
});

beforeEach(() => {
  resetObsidianMock();
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

/** Run a command, fill its modal, submit, and wait for the create flow's final notice. */
async function runCommand(Plugin: any, vault: FakeVault, commandId: string, fields: Record<string, unknown>) {
  const plugin = new Plugin(makeApp(vault), {});
  plugin.onload();
  plugin.commands.find((c: any) => c.id === commandId).callback();
  const modal: any = openedModals[0];
  Object.assign(modal, fields);
  modal.handleCreate();
  await vi.waitFor(() => expect(notices.length).toBeGreaterThan(0));
  expect(modal.closed).toBe(true);
}

async function expectFlow(caseName: string, vault: FakeVault, before: Record<string, string>) {
  const changed = Array.from(vault.contents.keys()).filter((p) => before[p] !== vault.contents.get(p));
  changed.sort();
  for (const path of changed) {
    await expect(vault.contents.get(path)).toMatchFileSnapshot(`__golden__/flows/${caseName}/${path}`);
  }
  await expect(json({ ops: vault.ops, notices, console: consoleLog, changed })).toMatchFileSnapshot(
    `__golden__/flows/${caseName}.json`
  );
}

describe('plugin end to end via commands', () => {
  it.each(['bundle'])('%s: create-bet command writes the golden notes', async (name) => {
    const { Plugin } = plugins.find((p) => p.name === name)!;
    const before = readTestVault();
    const vault = new FakeVault(before);
    await runCommand(Plugin, vault, 'create-bet', {
      title: 'Open a pop-up shop',
      x: 'renting a market corner on weekends',
      y: 'a pop-up shop that breaks even',
      z: 'six months',
      deadline: '2027-04-01',
      servesFiles: [vault.file('Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md')],
      assumptionRows: [
        { id: 1, mode: 'new', statement: 'Footfall on weekends is high enough.', falsifier: 'Under 100 visitors a day', verifyBy: '2026-11-30', existingFile: null },
        { id: 2, mode: 'new', statement: 'Permits take under a month', falsifier: '', verifyBy: '', existingFile: null },
        { id: 3, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md') },
        { id: 4, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') },
        { id: 5, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-7 Workshops can fill eight seats.md') },
        { id: 6, mode: 'existing', existingFile: vault.file('Strategy/Assumptions/A-1 D7 accepts freelance income.md') },
      ],
    });
    await expectFlow('bet-mixed', vault, before);
  });

  it.each(['bundle'])('%s: create-assumption command writes the golden notes', async (name) => {
    const { Plugin } = plugins.find((p) => p.name === name)!;
    const before = {
      ...readTestVault(),
      // Same fixture as flows.test.ts: both write the `assumption-linked` golden.
      'Strategy/Bets/B-9 No assumptions key.md': '---\ntype: bet\nstatus: active\n---\n## The Bet\nText\n',
      'Strategy/Bets/B-10 Scalar assumptions.md': '---\ntype: bet\nstatus: active\nassumptions: "[[A-2 Rent in Lisbon stays under 1200]]"\n---\n',
      'Strategy/Bets/B-11 Already listed.md': '---\ntype: bet\nstatus: active\nassumptions:\n  - "[[A-8 Ceramics fairs accept newcomers]]"\n---\n',
    };
    const vault = new FakeVault(before);
    const b4 = vault.file('Strategy/Bets/B-4 Save 20000 for kiln and lease.md');
    await runCommand(Plugin, vault, 'create-assumption', {
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
});
