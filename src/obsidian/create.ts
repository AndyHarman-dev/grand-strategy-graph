import { App, Notice, TFile } from 'obsidian';
import { planAssumption, planBet, planMilestone, type ActionPlan } from '../core/actions';
import { ASSUMPTIONS_FOLDER, BETS_FOLDER, MILESTONES_FOLDER } from '../core/constants';
import {
  isPlanError,
  type AssumptionFormData,
  type BetFormData,
  type MilestoneFormData,
  type PlanError,
} from '../core/plan';
import { describeWrite, runWrite } from '../core/writes';
import { ensureFolder, errorMessage, ObsidianIO } from './io';
import { today as todayIso } from './today';

/**
 * Run a planned action: new notes first, then link appends to existing notes through
 * `processFrontMatter` (never the body), then open the note. A failure part-way is reported with
 * what was already written; nothing is rolled back.
 */
async function execute(app: App, plan: ActionPlan | PlanError, what: string): Promise<void> {
  if (isPlanError(plan)) {
    console.error('strategy-bet-creator: aborted before writing —', plan.error);
    new Notice(plan.error, 15000);
    return;
  }

  const io = new ObsidianIO(app);
  const written: string[] = [];
  try {
    let opened: TFile | null = null;
    for (const write of plan.writes) {
      if (write.kind === 'create') {
        const file = await app.vault.create(write.path, write.content);
        written.push(write.path);
        if (write.path === plan.open) opened = file;
      } else {
        await runWrite(write, io);
        written.push(describeWrite(write));
      }
    }
    if (opened) await app.workspace.getLeaf(false).openFile(opened);
    new Notice(plan.notice);
  } catch (err) {
    console.error('strategy-bet-creator: failed part-way through ' + what + ' creation', err);
    new Notice(
      what[0].toUpperCase() +
        what.slice(1) +
        ' creation failed: ' +
        errorMessage(err) +
        (written.length
          ? '\nAlready ' + (what === 'assumption' ? 'written' : 'created') + ' (not rolled back): ' + written.join(', ')
          : what === 'assumption'
            ? ''
            : '\nNothing was created.'),
      20000
    );
  }
}

export async function createBetFromForm(app: App, data: BetFormData<TFile>): Promise<void> {
  await ensureFolder(app, BETS_FOLDER);
  await ensureFolder(app, ASSUMPTIONS_FOLDER);
  await execute(app, planBet(app.vault, data, todayIso()), 'bet');
}

export async function createAssumptionFromForm(app: App, data: AssumptionFormData<TFile>): Promise<void> {
  await ensureFolder(app, ASSUMPTIONS_FOLDER);
  await execute(app, planAssumption(app.vault, data, todayIso()), 'assumption');
}

export async function createMilestoneFromForm(app: App, data: MilestoneFormData<TFile>): Promise<void> {
  await ensureFolder(app, MILESTONES_FOLDER);
  await execute(app, planMilestone(app.vault, data, todayIso()), 'milestone');
}
