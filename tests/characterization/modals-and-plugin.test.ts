import { beforeEach, describe, expect, it } from 'vitest';
import { notices, openedModals, resetObsidianMock } from '../mocks/obsidian';
import { makeApp, testVault } from '../support/fake-app';
import StrategyBetCreator from '../../src/main';
import { AssumptionModal, BetModal, NoteModal } from '../../src/obsidian/modals';
import { json } from '../support/serialize';

/**
 * The modals' DOM is only exercised in real Obsidian; their submit-time
 * validation and the shape of the data handed to the create flows are pure
 * enough to pin down here.
 */

beforeEach(() => resetObsidianMock());

function submitBet(fields: Record<string, unknown>) {
  const submitted: unknown[] = [];
  const modal: any = new BetModal(makeApp(testVault()) as any, (data) => submitted.push(data));
  Object.assign(modal, fields);
  modal.handleCreate();
  return { submitted, closed: modal.closed, notices: notices.splice(0) };
}

function submitAssumption(fields: Record<string, unknown>) {
  const submitted: unknown[] = [];
  const modal: any = new AssumptionModal(makeApp(testVault()) as any, (data) => submitted.push(data));
  Object.assign(modal, fields);
  modal.handleCreate();
  return { submitted, closed: modal.closed, notices: notices.splice(0) };
}

describe('modals and plugin wiring (schema v2)', () => {
  it('BetModal initial state', () => {
    const modal = new BetModal(makeApp(testVault()) as any, () => {});
    expect({
      title: modal.title,
      titleTouched: modal.titleTouched,
      x: modal.x,
      y: modal.y,
      z: modal.z,
      deadline: modal.deadline,
      servesFiles: modal.servesFiles,
      ultimatelyServesFiles: modal.ultimatelyServesFiles,
      requiresFiles: modal.requiresFiles,
      nextFiles: modal.nextFiles,
      assumptionRows: modal.assumptionRows,
    }).toEqual({
      title: '',
      titleTouched: false,
      x: '',
      y: '',
      z: '',
      deadline: '',
      servesFiles: [],
      ultimatelyServesFiles: [],
      requiresFiles: [],
      nextFiles: [],
      assumptionRows: [],
    });
  });

  it('BetModal.handleCreate validation and submitted data', async () => {
    const vault = testVault();
    const fp1 = vault.file('Strategy/Fixed Points/FP-1 Live in Portugal.md');
    const a2 = vault.file('Strategy/Assumptions/A-2 Rent in Lisbon stays under 1200.md');
    const b3 = vault.file('Strategy/Bets/B-3 Sell pottery at weekend markets.md');
    const valid = { title: ' T ', x: ' x ', y: ' y ', z: ' z ', deadline: '2027-01-01', servesFiles: [fp1], assumptionRows: [] };
    const results = {
      missingTitle: submitBet({ ...valid, title: '   ' }),
      missingX: submitBet({ ...valid, x: '' }),
      missingY: submitBet({ ...valid, y: ' ' }),
      missingZ: submitBet({ ...valid, z: '' }),
      blankNewStatement: submitBet({
        ...valid,
        assumptionRows: [{ id: 1, mode: 'new', statement: '  ', falsifier: '', verifyBy: '', existingFile: null }],
      }),
      existingWithoutFile: submitBet({
        ...valid,
        assumptionRows: [{ id: 1, mode: 'existing', statement: '', falsifier: '', verifyBy: '', existingFile: null }],
      }),
      optionalRelations: submitBet({ ...valid, ultimatelyServesFiles: [fp1], requiresFiles: [b3], nextFiles: [b3] }),
      valid: submitBet({
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
    const modal = new BetModal(makeApp(vault) as any, (data) => submitted.push(data));
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
        const m = new AssumptionModal(makeApp(vault) as any, () => {});
        return { statement: m.statement, falsifier: m.falsifier, verifyBy: m.verifyBy, dependentFiles: m.dependentFiles };
      })(),
      missingStatement: submitAssumption({ statement: '  ', falsifier: 'f' }),
      valid: submitAssumption({ statement: ' S ', falsifier: ' F ', verifyBy: '', dependentFiles: [b1] }),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/modals/assumption-modal.json');
  });

  it('NoteModal.handleCreate validation and submitted data, per kind', async () => {
    const vault = testVault();
    const fp1 = vault.file('Strategy/Fixed Points/FP-1 Live in Portugal.md');
    const submit = (kind: 'route' | 'ghost-route' | 'milestone', fields: Record<string, unknown>) => {
      const submitted: unknown[] = [];
      const modal: any = new NoteModal(makeApp(vault) as any, kind, (data) => submitted.push(data));
      Object.assign(modal, fields);
      modal.handleCreate();
      return { submitted, closed: modal.closed, notices: notices.splice(0) };
    };
    const results = {
      missingTitle: submit('route', { title: '  ' }),
      route: submit('route', { title: ' Study ', description: ' d ', servesFiles: [fp1] }),
      ghost: submit('ghost-route', { title: 'O1?', servesFiles: [fp1] }),
      milestone: submit('milestone', { title: 'Done', description: '', servesFiles: [] }),
    };
    await expect(json(results)).toMatchFileSnapshot('__golden__/modals/note-modal.json');
  });

  it('plugin registers the same ribbon icons and commands', async () => {
    const plugin = new (StrategyBetCreator as any)(makeApp(testVault()), {});
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
