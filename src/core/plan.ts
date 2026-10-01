import { ASSUMPTIONS_FOLDER, BETS_FOLDER } from './constants';
import { buildAssumptionContent, buildBetContent } from './content';
import { parseIds } from './ids';
import { deriveAssumptionTitle, sanitizeTitle } from './text';

/** The parts of a vault file the planner reads. Obsidian's TFile satisfies it. */
export interface FileRef {
  path: string;
  basename: string;
}

/** The parts of a vault the planner reads. Obsidian's Vault satisfies it. */
export interface VaultLike<F extends FileRef = FileRef> {
  getMarkdownFiles(): F[];
  getAbstractFileByPath(path: string): unknown;
}

export interface AssumptionRow<F extends FileRef = FileRef> {
  id: number;
  mode: 'new' | 'existing';
  statement: string;
  falsifier: string;
  verifyBy: string;
  existingFile: F | null;
}

export interface BetFormData<F extends FileRef = FileRef> {
  title: string;
  x: string;
  y: string;
  z: string;
  deadline: string;
  servesFiles: F[];
  assumptionRows: AssumptionRow<F>[];
}

export interface AssumptionFormData<F extends FileRef = FileRef> {
  statement: string;
  falsifier: string;
  verifyBy: string;
  betFiles: F[];
}

export interface PlanError {
  error: string;
}

export interface PlannedNote {
  path: string;
  content: string;
}

export interface BetWritePlan<F extends FileRef = FileRef> {
  betId: number;
  betTitle: string;
  betPath: string;
  betLink: string;
  betContent: string;
  newAssumptions: PlannedNote[];
  reused: F[];
}

export interface AssumptionWritePlan<F extends FileRef = FileRef> {
  assumptionId: number;
  basename: string;
  path: string;
  link: string;
  content: string;
  bets: F[];
}

export function isPlanError(plan: object): plan is PlanError {
  return 'error' in plan;
}

export function getFilesInFolders<F extends FileRef>(vault: VaultLike<F>, folders: readonly string[]): F[] {
  return vault
    .getMarkdownFiles()
    .filter((f) => folders.some((folder) => f.path.startsWith(folder + '/')))
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

/**
 * Plan every id, title and path BEFORE writing anything, so an ambiguous id
 * space or a path collision aborts the run cleanly instead of leaving orphan
 * assumption notes pointing at a bet that was never created.
 * Returns { error } or the full write plan.
 */
export function buildWritePlan<F extends FileRef>(
  vault: VaultLike<F>,
  data: BetFormData<F>,
  today: string
): BetWritePlan<F> | PlanError {
  const betBasenames = getFilesInFolders(vault, [BETS_FOLDER]).map((f) => f.basename);
  const assumptionBasenames = getFilesInFolders(vault, [ASSUMPTIONS_FOLDER]).map((f) => f.basename);

  const bets = parseIds(betBasenames, 'B');
  const assumptions = parseIds(assumptionBasenames, 'A');

  if (bets.invalid.length || assumptions.invalid.length) {
    return {
      error:
        'Unparseable bet/assumption ids — nothing was created. Offending notes: ' +
        bets.invalid.concat(assumptions.invalid).join(', '),
    };
  }
  if (bets.duplicates.length) {
    return { error: 'Duplicate bet ids in ' + BETS_FOLDER + ': B-' + bets.duplicates.join(', B-') + '. Nothing was created.' };
  }
  if (assumptions.duplicates.length) {
    return {
      error:
        'Duplicate assumption ids in ' + ASSUMPTIONS_FOLDER + ': A-' + assumptions.duplicates.join(', A-') + '. Nothing was created.',
    };
  }

  const betTitle = sanitizeTitle(data.title);
  if (!betTitle) return { error: 'The bet title is empty after removing illegal filename characters. Nothing was created.' };

  const betId = bets.max + 1;
  if (bets.used.has(betId)) return { error: 'Computed bet id B-' + betId + ' already exists. Nothing was created.' };

  const betBasename = 'B-' + betId + ' ' + betTitle;
  const betLink = '[[' + betBasename + ']]';
  const betPath = BETS_FOLDER + '/' + betBasename + '.md';

  const newAssumptions: PlannedNote[] = [];
  const assumptionLinks: string[] = [];
  let nextAssumptionId = assumptions.max;

  for (const row of data.assumptionRows) {
    if (row.mode !== 'new') continue;
    nextAssumptionId += 1;
    if (assumptions.used.has(nextAssumptionId)) {
      return { error: 'Computed assumption id A-' + nextAssumptionId + ' already exists. Nothing was created.' };
    }
    // One source of truth: the same truncated title is used for the filename
    // and for the [[link]] written into the bet note.
    const title = deriveAssumptionTitle(row.statement) || 'Assumption ' + nextAssumptionId;
    const basename = 'A-' + nextAssumptionId + ' ' + title;
    newAssumptions.push({
      path: ASSUMPTIONS_FOLDER + '/' + basename + '.md',
      content: buildAssumptionContent({
        today,
        statement: String(row.statement || '').trim(),
        falsifier: String(row.falsifier || '').trim(),
        verifyBy: row.verifyBy || '',
        betLinks: [betLink],
      }),
    });
    assumptionLinks.push('[[' + basename + ']]');
  }

  // De-duplicate reused assumptions (the user may pick the same note twice).
  const reused: F[] = [];
  const seenReused = new Set<string>();
  for (const row of data.assumptionRows) {
    if (row.mode !== 'existing' || !row.existingFile) continue;
    if (seenReused.has(row.existingFile.path)) continue;
    seenReused.add(row.existingFile.path);
    reused.push(row.existingFile);
    assumptionLinks.push('[[' + row.existingFile.basename + ']]');
  }

  const servesBasenames = data.servesFiles.map((f) => f.basename);

  const plan: BetWritePlan<F> = {
    betId,
    betTitle,
    betPath,
    betLink,
    betContent: buildBetContent({
      today,
      x: data.x,
      y: data.y,
      z: data.z,
      deadline: data.deadline,
      servesBasenames,
      assumptionLinks,
    }),
    newAssumptions,
    reused,
  };

  // Pre-flight every target path.
  for (const target of [plan.betPath].concat(newAssumptions.map((a) => a.path))) {
    if (vault.getAbstractFileByPath(target)) {
      return { error: 'A note already exists at "' + target + '". Nothing was created.' };
    }
  }

  return plan;
}

/**
 * Plan a standalone assumption creation: next id, filename, content, and the
 * de-duplicated set of existing bets to backlink into. Same "plan everything
 * before writing" discipline as buildWritePlan — no bet is ever created here.
 */
export function buildAssumptionWritePlan<F extends FileRef>(
  vault: VaultLike<F>,
  data: AssumptionFormData<F>,
  today: string
): AssumptionWritePlan<F> | PlanError {
  const assumptionBasenames = getFilesInFolders(vault, [ASSUMPTIONS_FOLDER]).map((f) => f.basename);
  const assumptions = parseIds(assumptionBasenames, 'A');

  if (assumptions.invalid.length) {
    return {
      error: 'Unparseable assumption ids — nothing was created. Offending notes: ' + assumptions.invalid.join(', '),
    };
  }
  if (assumptions.duplicates.length) {
    return {
      error:
        'Duplicate assumption ids in ' + ASSUMPTIONS_FOLDER + ': A-' + assumptions.duplicates.join(', A-') + '. Nothing was created.',
    };
  }

  const assumptionId = assumptions.max + 1;
  if (assumptions.used.has(assumptionId)) {
    return { error: 'Computed assumption id A-' + assumptionId + ' already exists. Nothing was created.' };
  }

  const title = deriveAssumptionTitle(data.statement) || 'Assumption ' + assumptionId;
  const basename = 'A-' + assumptionId + ' ' + title;
  const path = ASSUMPTIONS_FOLDER + '/' + basename + '.md';

  if (vault.getAbstractFileByPath(path)) {
    return { error: 'A note already exists at "' + path + '". Nothing was created.' };
  }

  // De-duplicate reused bets (the user may pick the same note twice).
  const bets: F[] = [];
  const seenBets = new Set<string>();
  for (const file of data.betFiles) {
    if (seenBets.has(file.path)) continue;
    seenBets.add(file.path);
    bets.push(file);
  }

  return {
    assumptionId,
    basename,
    path,
    link: '[[' + basename + ']]',
    content: buildAssumptionContent({
      today,
      statement: data.statement,
      falsifier: data.falsifier,
      verifyBy: data.verifyBy || '',
      betLinks: bets.map((f) => '[[' + f.basename + ']]'),
    }),
    bets,
  };
}
