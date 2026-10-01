import { beforeEach, describe, expect, it } from 'vitest';
import { notices, openedModals, resetObsidianMock } from '../mocks/obsidian';
import { makeApp, testVault } from '../support/fake-app';
import { implementations, type Impl } from '../support/impls';
import { json } from '../support/serialize';

/**
 * The modals' DOM is only exercised in real Obsidian; their submit-time
 * validation and the shape of the data handed to the create flows are pure
 * enough to pin down here.
 */

beforeEach(() => resetObsidianMock());

function submitBet(impl: Impl, fields: Record<string, unknown>) {
  const submitted: unknown[] = [];
  const modal = new impl.BetModal(makeApp(testVault()), (data) => submitted.push(data));
  Object.assign(modal, fields);
  modal.handleCreate();
  return { submitted, closed: modal.closed, notices: notices.splice(0) };
}

function submitAssumption(impl: Impl, fields: Record<string, unknown>) {
  const submitted: unknown[] = [];
  const modal = new impl.AssumptionModal(makeApp(testVault()), (data) => submitted.push(data));
  Object.assign(modal, fields);
  modal.handleCreate();
  return { submitted, closed: modal.closed, notices: notices.splice(0) };
}

describe.each(implementations)('modals and plugin wiring ($name)', (impl) => {
  it('BetModal initial state', () => {
    const modal = new impl.BetModal(makeApp(testVault()), () => {});
    expect({
      title: modal.title,
      titleTouched: modal.titleTouched,
      x: modal.x,
      y: modal.y,
      z: modal.z,
      deadline: modal.deadline,
      servesFiles: modal.servesFiles,
      assumptionRows: modal.assumptionRows,
    }).toEqual({ title: '', titleTouched: false, x: '', y: '', z: '', deadline: '', servesFiles: [], assumptionRows: [] });
  });

  it('BetModal.handleCreate validation and submitted data', async () => {
    const vault = testVault();
    const fp1 = vault.file('Strategy/Fixed Points/FP-1 Live in Portugal.md');
    const a2 = vault.file('Strategy/Assumptions/A-2 Rent in Lisbon stays under 1200.md');
    const valid = { title: ' T ', x: ' x ', y: ' y ', z: ' z ', deadline: '2027-01-01', servesFiles: [fp1], assumptionRows: [] };
    const results = {
      missingTitle: submitBet(impl, { ...valid, title: '   ' }),
      missingX: submitBet(impl, { ...valid, x: '' }),
      missingY: submitBet(impl, { ...valid, y: ' ' }),
      missingZ: submitBet(impl, { ...valid, z: '' }),
      blankNewStatement: submitBet(impl, {
        ...valid,
        assumptionRows: [{ id: 1, mode: 'new', statement: '  ', falsifier: '', verifyBy: '', existingFile: null }],
      }),
      existingWithoutFile: submitBet(impl, {
        ...valid,
        assumptionRows: [{ id: 1, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: null }],
      }),
      valid: submitBet(impl, {
        ...valid,
        assumptionRows: [
          { id: 1, mode: 'new', statement: ' S ', falsifier: ' F ', verifyBy: '2026-12-01', existingFile: null },
          { id: 2, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: a2 },
        ],
      }),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/modals/bet-modal.json');
  });

  it('BetModal submits copies, not the live arrays', () => {
    const vault = testVault();
    const submitted: any[] = [];
    const modal = new impl.BetModal(makeApp(vault), (data) => submitted.push(data));
    const row = { id: 1, mode: 'new', statement: 'S', falsifier: '', verifyBy: '', existingFile: null };
    Object.assign(modal, { title: 'T', x: 'x', y: 'y', z: 'z', assumptionRows: [row] });
    modal.handleCreate();
    expect(submitted[0].servesFiles).not.toBe(modal.servesFiles);
    expect(submitted[0].assumptionRows[0]).not.toBe(row);
    expect(submitted[0].assumptionRows[0]).toEqual(row);
  });

  it('AssumptionModal.handleCreate validation and submitted data', async () => {
    const vault = testVault();
    const b1 = vault.file('Strategy/Bets/B-1 Get a D7 visa.md');
    const results = {
      initial: (() => {
        const m = new impl.AssumptionModal(makeApp(vault), () => {});
        return { statement: m.statement, falsifier: m.falsifier, verifyBy: m.verifyBy, betFiles: m.betFiles };
      })(),
      missingStatement: submitAssumption(impl, { statement: '  ', falsifier: 'f' }),
      valid: submitAssumption(impl, { statement: ' S ', falsifier: ' F ', verifyBy: '', betFiles: [b1] }),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/modals/assumption-modal.json');
  });

  it('plugin registers the same ribbon icons and commands', async () => {
    const plugin = new impl.Plugin(makeApp(testVault()), {});
    plugin.onload();
    const opens = (callback: () => void) => {
      openedModals.length = 0;
      callback();
      return openedModals.map((m) => m.constructor.name);
    };
    const registrations = {
      ribbonIcons: plugin.ribbonIcons.map((r: any) => ({ icon: r.icon, title: r.title, opens: opens(r.callback) })),
      commands: plugin.commands.map((c: any) => ({ id: c.id, name: c.name, opens: opens(c.callback) })),
      notices: notices.length,
    };
    await expect(json(registrations)).toMatchFileSnapshot('__golden__/modals/plugin-registrations.json');
  });
});
