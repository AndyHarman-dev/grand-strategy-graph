/**
 * Creation intents as pure "intent → planned writes" functions (plan Phase 4). Nothing is
 * written here: every id, title and path is planned BEFORE the adapter touches the vault, so an
 * ambiguous id space or a path collision aborts the run cleanly instead of leaving orphan notes.
 *
 * There are no cross-note body writes (D2). A relation is a frontmatter link on the note that
 * holds it, so creating writes to an existing note only through `add-link`: append one link to a list
 * field. Changing existing notes is `edits.ts`; the write kinds are in `writes.ts`.
 */
import { ASSUMPTIONS_FOLDER, BETS_FOLDER, FIXED_POINTS_FOLDER, MILESTONES_FOLDER } from './constants';
import { addLinkToField } from './link-field';
import { buildAssumptionContent, buildBetContent, buildMilestoneContent } from './content';
import { parseIds, type ParsedIds } from './ids';
import {
  getFilesInFolders,
  type AssumptionFormData,
  type BetFormData,
  type FileRef,
  type MilestoneFormData,
  type PlanError,
  type VaultLike,
} from './plan';
import { relationFor, targetsOf, type NodeType } from './schema';
import { deriveAssumptionTitle, sanitizeTitle } from './text';
import type { PlannedWrite } from './writes';

export { addLinkToField };
export type { PlannedWrite };

export interface ActionPlan {
  /** In order: new notes first, so what links to them points at real files. */
  writes: PlannedWrite[];
  /** The note to open once everything is written; null to stay where the user is (the graph). */
  open: string | null;
  notice: string;
  /** The note a creation plan makes, for the caller that has to refer to it (promoting a card). Set by `edits.ts`, not by the planners, whose plans the goldens pin. */
  created?: { id: string; path: string };
}

/** The folder the plugin creates each pickable type in. Every type in RELATIONS needs one. */
export const FOLDER_OF: Partial<Record<NodeType, string>> = {
  bet: BETS_FOLDER,
  assumption: ASSUMPTIONS_FOLDER,
  'fixed-point': FIXED_POINTS_FOLDER,
  milestone: MILESTONES_FOLDER,
};
const foldersOf = (types: readonly NodeType[]) => types.flatMap((t) => (FOLDER_OF[t] ? [FOLDER_OF[t]] : []));

/** Folders a form may pick from for `field` on a note of type `holder` (read off RELATIONS in schema.ts). */
export function pickFolders(field: string, holder: NodeType): string[] {
  return foldersOf(targetsOf(relationFor(field), holder) ?? []);
}

/** Folders of the types that may carry `assumptions`: the notes a new assumption can attach to. */
export const ASSUMPTION_HOLDER_FOLDERS = foldersOf(Object.keys(relationFor('assumptions').to) as NodeType[]);

interface IdKind {
  label: string;
  prefix: string;
  folder: string;
}

const BET: IdKind = { label: 'bet', prefix: 'B', folder: BETS_FOLDER };
const ASSUMPTION: IdKind = { label: 'assumption', prefix: 'A', folder: ASSUMPTIONS_FOLDER };
const MILESTONE: IdKind = { label: 'milestone', prefix: 'M', folder: MILESTONES_FOLDER };

/** The id spaces of the given kinds, or an error when one is ambiguous (never guess an id). */
function loadIds<F extends FileRef>(vault: VaultLike<F>, kinds: IdKind[]): ParsedIds[] | PlanError {
  const parsed = kinds.map((k) =>
    parseIds(
      getFilesInFolders(vault, [k.folder]).map((f) => f.basename),
      k.prefix
    )
  );
  const invalid = parsed.flatMap((p) => p.invalid);
  if (invalid.length) {
    return {
      error: 'Unparseable ' + kinds.map((k) => k.label).join('/') + ' ids — nothing was created. Offending notes: ' + invalid.join(', '),
    };
  }
  for (let i = 0; i < kinds.length; i++) {
    const dup = parsed[i].duplicates;
    if (dup.length) {
      return { error: 'Duplicate ' + kinds[i].label + ' ids in ' + kinds[i].folder + ': ' + kinds[i].prefix + '-' + dup.join(', ' + kinds[i].prefix + '-') + '. Nothing was created.' };
    }
  }
  return parsed;
}

const isError = (x: unknown): x is PlanError => !!x && typeof x === 'object' && 'error' in x;

function dedupe<F extends FileRef>(files: readonly F[] | undefined): F[] {
  const seen = new Set<string>();
  const out: F[] = [];
  for (const f of files ?? []) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    out.push(f);
  }
  return out;
}

/** A form pick must sit in one of the folders its field allows (the relation table), else nothing is created. */
function checkFolders(what: string, files: readonly FileRef[], allowed: readonly string[]): PlanError | null {
  const bad = files.filter((f) => !allowed.some((folder) => f.path.startsWith(folder + '/')));
  if (!bad.length) return null;
  return { error: what + ' must be notes in ' + allowed.join(', ') + ' (not ' + bad.map((f) => f.basename).join(', ') + '). Nothing was created.' };
}

function checkTargets<F extends FileRef>(vault: VaultLike<F>, paths: string[]): PlanError | null {
  for (const path of paths) {
    if (vault.getAbstractFileByPath(path)) return { error: 'A note already exists at "' + path + '". Nothing was created.' };
  }
  return null;
}

const links = (files: readonly FileRef[]) => files.map((f) => f.basename);

export function planBet<F extends FileRef>(vault: VaultLike<F>, data: BetFormData<F>, today: string): ActionPlan | PlanError {
  const ids = loadIds(vault, [BET, ASSUMPTION]);
  if (isError(ids)) return ids;
  const [bets, assumptions] = ids;

  const betTitle = sanitizeTitle(data.title);
  if (!betTitle) return { error: 'The bet title is empty after removing illegal filename characters. Nothing was created.' };

  const betId = bets.max + 1;
  if (bets.used.has(betId)) return { error: 'Computed bet id B-' + betId + ' already exists. Nothing was created.' };

  const serves = dedupe(data.servesFiles);
  const ultimatelyServes = dedupe(data.ultimatelyServesFiles);
  const requires = dedupe(data.requiresFiles);
  const next = data.nextFile ?? null;
  const folderError =
    checkFolders('"Serves"', serves, pickFolders('serves', 'bet')) ??
    checkFolders('"Ultimately serves"', ultimatelyServes, pickFolders('ultimately-serves', 'bet')) ??
    checkFolders('"Requires"', requires, pickFolders('requires', 'bet')) ??
    checkFolders('"Next"', next ? [next] : [], pickFolders('next', 'bet')) ??
    checkFolders(
      'Existing assumptions',
      data.assumptionRows.flatMap((r) => (r.mode === 'existing' && r.existingFile ? [r.existingFile] : [])),
      pickFolders('assumptions', 'bet')
    );
  if (folderError) return folderError;

  const betBasename = 'B-' + betId + ' ' + betTitle;
  const betPath = BETS_FOLDER + '/' + betBasename + '.md';

  const writes: PlannedWrite[] = [];
  const assumptionBasenames: string[] = [];
  let nextAssumptionId = assumptions.max;
  let newCount = 0;

  for (const row of data.assumptionRows) {
    if (row.mode !== 'new') continue;
    nextAssumptionId += 1;
    if (assumptions.used.has(nextAssumptionId)) {
      return { error: 'Computed assumption id A-' + nextAssumptionId + ' already exists. Nothing was created.' };
    }
    // One source of truth: the same truncated title is used for the filename and for the link in the bet's `assumptions`.
    const title = deriveAssumptionTitle(row.statement) || 'Assumption ' + nextAssumptionId;
    const basename = 'A-' + nextAssumptionId + ' ' + title;
    writes.push({
      kind: 'create',
      path: ASSUMPTIONS_FOLDER + '/' + basename + '.md',
      content: buildAssumptionContent({
        today,
        id: 'A-' + nextAssumptionId,
        statement: String(row.statement || '').trim(),
        falsifier: String(row.falsifier || '').trim(),
        verifyBy: row.verifyBy || '',
      }),
    });
    assumptionBasenames.push(basename);
    newCount += 1;
  }

  // De-duplicate reused assumptions (the user may pick the same note twice).
  const reused = dedupe(data.assumptionRows.flatMap((r) => (r.mode === 'existing' && r.existingFile ? [r.existingFile] : [])));
  assumptionBasenames.push(...links(reused));

  writes.push({
    kind: 'create',
    path: betPath,
    content: buildBetContent({
      today,
      id: 'B-' + betId,
      x: data.x,
      y: data.y,
      z: data.z,
      deadline: data.deadline,
      servesBasenames: links(serves),
      ultimatelyServesBasenames: links(ultimatelyServes),
      requiresBasenames: links(requires),
      nextBasename: next ? next.basename : null,
      assumptionBasenames,
    }),
  });

  const collision = checkTargets(
    vault,
    writes.flatMap((w) => (w.kind === 'create' ? [w.path] : []))
  );
  if (collision) return collision;

  return {
    writes,
    open: betPath,
    notice: 'Created B-' + betId + ' ' + betTitle + ' — ' + newCount + ' new assumption(s), ' + reused.length + ' reused.',
  };
}

export function planAssumption<F extends FileRef>(vault: VaultLike<F>, data: AssumptionFormData<F>, today: string): ActionPlan | PlanError {
  const ids = loadIds(vault, [ASSUMPTION]);
  if (isError(ids)) return ids;
  const [assumptions] = ids;

  const assumptionId = assumptions.max + 1;
  if (assumptions.used.has(assumptionId)) {
    return { error: 'Computed assumption id A-' + assumptionId + ' already exists. Nothing was created.' };
  }

  const title = deriveAssumptionTitle(data.statement) || 'Assumption ' + assumptionId;
  const basename = 'A-' + assumptionId + ' ' + title;
  const path = ASSUMPTIONS_FOLDER + '/' + basename + '.md';

  const dependents = dedupe(data.dependentFiles);
  const folderError = checkFolders('Notes that depend on an assumption', dependents, ASSUMPTION_HOLDER_FOLDERS);
  if (folderError) return folderError;
  const collision = checkTargets(vault, [path]);
  if (collision) return collision;

  const link = '[[' + basename + ']]';
  return {
    writes: [
      {
        kind: 'create',
        path,
        content: buildAssumptionContent({
          today,
          id: 'A-' + assumptionId,
          statement: data.statement,
          falsifier: data.falsifier,
          verifyBy: data.verifyBy || '',
        }),
      },
      ...dependents.map((f): PlannedWrite => ({ kind: 'add-link', path: f.path, field: 'assumptions', link })),
    ],
    open: path,
    notice: 'Created ' + basename + ' — linked to ' + dependents.length + ' note(s).',
  };
}

/** A milestone: a checkpoint further bets start from (D17). It is created `open`. */
export function planMilestone<F extends FileRef>(vault: VaultLike<F>, data: MilestoneFormData<F>, today: string): ActionPlan | PlanError {
  const ids = loadIds(vault, [MILESTONE]);
  if (isError(ids)) return ids;
  const [space] = ids;

  const title = sanitizeTitle(data.title);
  if (!title) return { error: 'The milestone title is empty after removing illegal filename characters. Nothing was created.' };

  const n = space.max + 1;
  if (space.used.has(n)) return { error: 'Computed milestone id M-' + n + ' already exists. Nothing was created.' };

  const serves = dedupe(data.servesFiles);
  const folderError = checkFolders('"Serves"', serves, pickFolders('serves', 'milestone'));
  if (folderError) return folderError;

  const basename = 'M-' + n + ' ' + title;
  const path = MILESTONES_FOLDER + '/' + basename + '.md';
  const collision = checkTargets(vault, [path]);
  if (collision) return collision;

  return {
    writes: [{ kind: 'create', path, content: buildMilestoneContent({ today, id: 'M-' + n, description: data.description.trim(), servesBasenames: links(serves) }) }],
    open: path,
    notice: 'Created ' + basename + '.',
  };
}
