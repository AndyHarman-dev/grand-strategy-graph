/**
 * Phase 3: apply a reviewed dry run to a vault. The planner already decided every byte;
 * this only (1) proves the vault is still what the dry run saw, (2) backs it up outside the
 * vault, (3) writes the planned content and (4) re-checks the live result.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { STRATEGY_ROOT } from '../../src/core/memory-adapter';
import { readVaultFiles } from '../fs-adapter';
import { parityGate } from './parity';
import { DEFAULT_CANVAS_PATH, DEFAULT_TEMPLATES_FOLDER, planMigration } from './plan';
import { verdictOf, type Verdict } from './report';
import type { MigrationPlan } from './types';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** `migration-plan.json`, as the dry run writes it. */
export interface PlanFile {
  generatedAt: string;
  verdict: Verdict;
  files: { path: string; before: string | null; after: string }[];
}

export interface ApplyOptions {
  vault: string;
  plan: MigrationPlan;
  planFile: PlanFile;
  resolutions: Record<string, unknown>;
  /** Parent of the timestamped backup folder. Must be outside the vault. */
  backupRoot: string;
  now: Date;
}

export interface ApplyResult {
  /** True only when every step passed, including the check of the live result. */
  ok: boolean;
  /** Set once anything was written (or backed up), so the caller can point at it. */
  backupDir: string | null;
  written: string[];
  backedUp: number;
  /** Why nothing was written (guard / refusal), or what the post-check found wrong. */
  problems: string[];
  /** Nothing was written to the vault. */
  untouched: boolean;
}

export const isInside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const readDisk = (vault: string, path: string): string | null => {
  const abs = join(vault, path);
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
};

/** Differences between the live vault, the recomputed plan, and the reviewed dry run. Empty = safe to apply. */
export function guardAgainstDryRun(vault: string, plan: MigrationPlan, planFile: PlanFile): string[] {
  const problems: string[] = [];
  if (planFile.verdict !== 'passed') problems.push(`the dry run's verdict was "${planFile.verdict}", not "passed"`);
  const reviewed = new Map(planFile.files.map((f) => [f.path, f]));
  const planned = new Map(plan.changes.map((c) => [c.path, c]));
  for (const path of planned.keys()) if (!reviewed.has(path)) problems.push(`${path}: planned now but not in the reviewed dry run`);
  for (const path of reviewed.keys()) if (!planned.has(path)) problems.push(`${path}: in the reviewed dry run but no longer planned`);
  for (const [path, change] of planned) {
    const was = reviewed.get(path);
    if (!was) continue;
    const live = readDisk(vault, path);
    const liveHash = live === null ? null : sha256(live);
    if (liveHash !== was.before) problems.push(`${path}: content changed since the dry run (was ${was.before?.slice(0, 12) ?? 'absent'}, now ${liveHash?.slice(0, 12) ?? 'absent'})`);
    if (sha256(change.after) !== was.after) problems.push(`${path}: planned content differs from the reviewed dry run`);
  }
  return problems;
}

/** Vault-relative files to copy: every touched file, the canvas, and the strategy and template folders. */
function backupList(allPaths: readonly string[], plan: MigrationPlan): string[] {
  const set = new Set<string>();
  for (const c of plan.changes) if (c.before !== null) set.add(c.path);
  if (allPaths.includes(DEFAULT_CANVAS_PATH)) set.add(DEFAULT_CANVAS_PATH);
  for (const p of allPaths) if (p.startsWith(STRATEGY_ROOT + '/') || p.startsWith(DEFAULT_TEMPLATES_FOLDER + '/')) set.add(p);
  // Notes the kept (D13) links resolve to, such as the phantom FP-2 at the vault root.
  for (const e of plan.edges) if (e.fate.kind === 'kept' && e.edge.toPath && allPaths.includes(e.edge.toPath)) set.add(e.edge.toPath);
  return [...set].sort();
}

export async function applyMigration(opts: ApplyOptions): Promise<ApplyResult> {
  const { vault, plan, planFile } = opts;
  const refuse = (problems: string[]): ApplyResult => ({ ok: false, backupDir: null, written: [], backedUp: 0, problems, untouched: true });

  if (isInside(vault, opts.backupRoot)) return refuse([`the backup folder ${opts.backupRoot} is inside the vault: a copy there would duplicate basenames and break link resolution`]);
  const files = readVaultFiles(vault, (p) => /\.(md|canvas|gsmap)$/.test(p));
  const gate = await parityGate(files, plan);
  const verdict = verdictOf(gate);
  if (verdict !== 'passed') return refuse([`the parity gate is "${verdict}" on this vault; apply needs "passed" (re-run the dry run)`]);
  if (plan.changes.some((c) => c.path === DEFAULT_CANVAS_PATH)) return refuse([`the plan would change ${DEFAULT_CANVAS_PATH}, which is never written`]);
  const guard = guardAgainstDryRun(vault, plan, planFile);
  if (guard.length) return refuse(['the vault is not what the dry run saw, nothing was written:', ...guard]);

  // ---- backup (verified byte for byte before the first write)
  const stamp = opts.now.toISOString().replace(/[:.]/g, '-');
  const backupDir = join(opts.backupRoot, stamp);
  if (existsSync(backupDir)) return refuse([`${backupDir} already exists`]);
  const list = backupList(Object.keys(files), plan);
  const mismatched: string[] = [];
  for (const path of list) {
    const dest = join(backupDir, path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(vault, path), dest);
    if (sha256(readFileSync(dest)) !== sha256(readFileSync(join(vault, path)))) mismatched.push(path);
  }
  if (mismatched.length) return { ...refuse([`the backup does not match the vault for: ${mismatched.join(', ')}`]), backupDir };

  // ---- write
  const canvasBefore = readDisk(vault, DEFAULT_CANVAS_PATH);
  const written: string[] = [];
  try {
    for (const change of plan.changes) {
      const abs = join(vault, change.path);
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.migrate-tmp`;
      writeFileSync(tmp, change.after, 'utf8');
      renameSync(tmp, abs);
      written.push(change.path);
    }
  } catch (e) {
    return { ok: false, backupDir, written, backedUp: list.length, untouched: written.length === 0, problems: [`write failed after ${written.length} of ${plan.changes.length} files: ${(e as Error).message}`, `restore from ${backupDir}`] };
  }

  // ---- re-check the live result
  const problems: string[] = [];
  for (const change of plan.changes) if (readDisk(vault, change.path) !== change.after) problems.push(`${change.path}: on-disk content differs from the plan`);
  if (readDisk(vault, DEFAULT_CANVAS_PATH) !== canvasBefore) problems.push(`${DEFAULT_CANVAS_PATH} changed`);
  const live = readVaultFiles(vault, (p) => /\.(md|canvas|gsmap)$/.test(p));
  const again = planMigration(live, { resolutions: opts.resolutions });
  if (again.changes.length) problems.push(`re-planning the migrated vault still wants to change: ${again.changes.map((c) => c.path).join(', ')}`);
  const liveVerdict = verdictOf(await parityGate(live, again));
  if (liveVerdict !== 'passed') problems.push(`parity gate on the live result is "${liveVerdict}"`);
  if (problems.length) problems.push(`restore from ${backupDir} if this is not what you expect`);
  return { ok: problems.length === 0, backupDir, written, backedUp: list.length, problems, untouched: false };
}
