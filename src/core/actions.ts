/**
 * Creation intents as pure "intent → planned writes" functions (plan Phase 4). Nothing is
 * written here: every id, title and path is planned BEFORE the adapter touches the vault, so an
 * ambiguous id space or a path collision aborts the run cleanly instead of leaving orphan notes.
 *
 * There are no cross-note body writes (D2). A relation is a frontmatter link on the note that
 * holds it, so the only write to an existing note is `add-link`: append one link to a list field.
 */
import {
  ASSUMPTIONS_FOLDER,
  BETS_FOLDER,
  FIXED_POINTS_FOLDER,
  MILESTONES_FOLDER,
  ROUTES_FOLDER,
} from './constants';
import {
  buildAssumptionContent,
  buildBetContent,
  buildMilestoneContent,
  buildRouteContent,
} from './content';
import { parseIds, type ParsedIds } from './ids';
import { linkpathOf } from './links';
import {
  getFilesInFolders,
  type AssumptionFormData,
  type BetFormData,
  type FileRef,
  type MilestoneFormData,
  type PlanError,
  type RouteFormData,
  type VaultLike,
} from './plan';
import { deriveAssumptionTitle, sanitizeTitle } from './text';

export type PlannedWrite =
  /** A new note. */
  | { kind: 'create'; path: string; content: string }
  /** Append `link` to the list field `field` of an existing note's frontmatter, unless it is already there. */
  | { kind: 'add-link'; path: string; field: 'assumptions'; link: string };

export interface ActionPlan {
  /** In order: new notes first, so what links to them points at real files. */
  writes: PlannedWrite[];
  /** The note to open once everything is written. */
  open: string;
  notice: string;
}

/** Folders a note may sit in to carry each relation field (mirrors RELATIONS in schema.ts). */
const SERVES_TARGETS = [FIXED_POINTS_FOLDER, BETS_FOLDER, ROUTES_FOLDER, MILESTONES_FOLDER];
/** Types that may carry `assumptions`. */
export const ASSUMPTION_HOLDER_FOLDERS = [BETS_FOLDER, FIXED_POINTS_FOLDER, ROUTES_FOLDER, MILESTONES_FOLDER];
export const SERVES_FOLDERS = SERVES_TARGETS;

/**
 * `link` appended to a frontmatter list value, as Obsidian hands it over: nothing, one string
 * or a list. Returns the same value when the link is already there (matched by link path,
 * ignoring case, alias and heading), so callers can tell nothing changed.
 */
export function addLinkToField(value: unknown, link: string): unknown {
  const target = linkpathOf(link.replace(/^\[\[|\]\]$/g, '')).toLowerCase();
  const has = (item: unknown) =>
    typeof item === 'string' && Array.from(item.matchAll(/\[\[([^\]]*)\]\]/g)).some((m) => linkpathOf(m[1]).toLowerCase() === target);
  if (value == null || value === '') return [link];
  if (Array.isArray(value)) return value.some(has) ? value : [...value, link];
  if (typeof value === 'string') return has(value) ? value : [value, link];
  return [String(value), link];
}

interface IdKind {
  label: string;
  prefix: string;
  folder: string;
}

const BET: IdKind = { label: 'bet', prefix: 'B', folder: BETS_FOLDER };
const ASSUMPTION: IdKind = { label: 'assumption', prefix: 'A', folder: ASSUMPTIONS_FOLDER };
const ROUTE: IdKind = { label: 'route', prefix: 'R', folder: ROUTES_FOLDER };
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
    checkFolders('"Serves"', serves, SERVES_FOLDERS) ??
    checkFolders('"Ultimately serves"', ultimatelyServes, [FIXED_POINTS_FOLDER]) ??
    checkFolders('"Requires"', requires, [BETS_FOLDER]) ??
    checkFolders('"Next"', next ? [next] : [], [BETS_FOLDER]) ??
    checkFolders(
      'Existing assumptions',
      data.assumptionRows.flatMap((r) => (r.mode === 'existing' && r.existingFile ? [r.existingFile] : [])),
      [ASSUMPTIONS_FOLDER]
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

/** Shared by routes and milestones: next id in the folder, a sanitized title, collision check. */
function planPlainNote<F extends FileRef>(
  vault: VaultLike<F>,
  kind: IdKind,
  rawTitle: string,
  servesFiles: F[],
  build: (id: string, serves: string[]) => string
): ActionPlan | PlanError {
  const ids = loadIds(vault, [kind]);
  if (isError(ids)) return ids;
  const [space] = ids;

  const title = sanitizeTitle(rawTitle);
  if (!title) return { error: 'The ' + kind.label + ' title is empty after removing illegal filename characters. Nothing was created.' };

  const n = space.max + 1;
  if (space.used.has(n)) return { error: 'Computed ' + kind.label + ' id ' + kind.prefix + '-' + n + ' already exists. Nothing was created.' };

  const serves = dedupe(servesFiles);
  const folderError = checkFolders('"Serves"', serves, SERVES_FOLDERS);
  if (folderError) return folderError;

  const basename = kind.prefix + '-' + n + ' ' + title;
  const path = kind.folder + '/' + basename + '.md';
  const collision = checkTargets(vault, [path]);
  if (collision) return collision;

  return {
    writes: [{ kind: 'create', path, content: build(kind.prefix + '-' + n, links(serves)) }],
    open: path,
    notice: 'Created ' + basename + '.',
  };
}

/** A route, or with `ghost` a suspected, unexplored one. */
export function planRoute<F extends FileRef>(vault: VaultLike<F>, data: RouteFormData<F>, today: string): ActionPlan | PlanError {
  return planPlainNote(vault, ROUTE, data.title, data.servesFiles, (id, serves) =>
    buildRouteContent({ today, id, ghost: data.ghost, description: data.description.trim(), servesBasenames: serves })
  );
}

export function planMilestone<F extends FileRef>(vault: VaultLike<F>, data: MilestoneFormData<F>, today: string): ActionPlan | PlanError {
  return planPlainNote(vault, MILESTONE, data.title, data.servesFiles, (id, serves) =>
    buildMilestoneContent({ today, id, description: data.description.trim(), servesBasenames: serves })
  );
}
