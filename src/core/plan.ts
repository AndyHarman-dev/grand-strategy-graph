/** The inputs of the creation forms, and the vault listing they share. The planners are in `actions.ts`. */

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
  /** Direct parents: bets, routes, milestones or fixed points. */
  servesFiles: F[];
  /** Far anchors: fixed points. Optional. */
  ultimatelyServesFiles?: F[];
  /** Prerequisite bets. Optional. */
  requiresFiles?: F[];
  /** The sequel bet activated when this one is killed. Optional. */
  nextFile?: F | null;
  assumptionRows: AssumptionRow<F>[];
}

export interface AssumptionFormData<F extends FileRef = FileRef> {
  statement: string;
  falsifier: string;
  verifyBy: string;
  /** The bets, fixed points, routes or milestones that lean on this assumption: each gets it in its `assumptions`. */
  dependentFiles: F[];
}

export interface RouteFormData<F extends FileRef = FileRef> {
  /** A ghost route is a suspected, unexplored one (`status: ghost`). */
  ghost: boolean;
  title: string;
  description: string;
  servesFiles: F[];
}

export interface MilestoneFormData<F extends FileRef = FileRef> {
  title: string;
  description: string;
  servesFiles: F[];
}

export interface PlanError {
  error: string;
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
