import { App, Notice, TFile } from 'obsidian';
import { ASSUMPTIONS_FOLDER, BET_ASSUMPTIONS_HEADING, BETS_FOLDER, DEPENDED_ON_BY_HEADING } from '../core/constants';
import {
  buildAssumptionWritePlan,
  buildWritePlan,
  isPlanError,
  type AssumptionFormData,
  type BetFormData,
} from '../core/plan';
import { insertIntoSection } from '../core/sections';
import { today as todayIso } from './today';

/** `err.message` when there is a truthy one, otherwise the stringified value. */
export function errorMessage(err: unknown): string {
  const e = err as { message?: unknown } | null | undefined;
  return e && e.message ? String(e.message) : String(err);
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  try {
    await app.vault.createFolder(path);
  } catch (err) {
    // Racy "already exists" is fine; anything else surfaces on the create call.
    console.warn('strategy-bet-creator: createFolder(' + path + ') failed', err);
  }
}

export async function createBetFromForm(app: App, data: BetFormData<TFile>): Promise<void> {
  const today = todayIso();

  await ensureFolder(app, BETS_FOLDER);
  await ensureFolder(app, ASSUMPTIONS_FOLDER);

  const plan = buildWritePlan(app.vault, data, today);
  if (isPlanError(plan)) {
    console.error('strategy-bet-creator: aborted before writing —', plan.error);
    new Notice(plan.error, 15000);
    return;
  }

  const created: string[] = [];
  try {
    // 1. New assumptions first, so the bet can link to real files.
    for (const assumption of plan.newAssumptions) {
      await app.vault.create(assumption.path, assumption.content);
      created.push(assumption.path);
    }

    // 2. The bet itself.
    const betFile = await app.vault.create(plan.betPath, plan.betContent);
    created.push(plan.betPath);

    // 3. Backlink into every reused assumption, idempotently.
    for (const file of plan.reused) {
      await app.vault.process(file, (content) =>
        insertIntoSection(content, DEPENDED_ON_BY_HEADING, '- ' + plan.betLink, plan.betLink)
      );
    }

    await app.workspace.getLeaf(false).openFile(betFile);

    new Notice(
      'Created B-' +
        plan.betId +
        ' ' +
        plan.betTitle +
        ' — ' +
        plan.newAssumptions.length +
        ' new assumption(s), ' +
        plan.reused.length +
        ' reused.'
    );
  } catch (err) {
    console.error('strategy-bet-creator: failed part-way through creation', err);
    new Notice(
      'Bet creation failed: ' +
        errorMessage(err) +
        (created.length ? '\nAlready created (not rolled back): ' + created.join(', ') : '\nNothing was created.'),
      20000
    );
  }
}

export async function createAssumptionFromForm(app: App, data: AssumptionFormData<TFile>): Promise<void> {
  const today = todayIso();

  await ensureFolder(app, ASSUMPTIONS_FOLDER);

  const plan = buildAssumptionWritePlan(app.vault, data, today);
  if (isPlanError(plan)) {
    console.error('strategy-bet-creator: aborted before writing —', plan.error);
    new Notice(plan.error, 15000);
    return;
  }

  try {
    const assumptionFile = await app.vault.create(plan.path, plan.content);

    // Backlink into every selected bet's "Assumptions This Bet Depends On", idempotently.
    for (const betFile of plan.bets) {
      await app.vault.process(betFile, (content) =>
        insertIntoSection(content, BET_ASSUMPTIONS_HEADING, '- ' + plan.link, plan.link)
      );
    }

    await app.workspace.getLeaf(false).openFile(assumptionFile);

    new Notice('Created ' + plan.basename + ' — linked to ' + plan.bets.length + ' bet(s).');
  } catch (err) {
    console.error('strategy-bet-creator: failed part-way through assumption creation', err);
    new Notice('Assumption creation failed: ' + errorMessage(err), 20000);
  }
}
