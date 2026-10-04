/**
 * Plan an edit intent and perform it: what the Obsidian view and the dev page both do when the
 * graph asks for an edit, so it is tested once, here (the adapters bring their own `WriteIO`).
 */
import { planIntent, type EditEnv, type Intent } from './edits';
import { isPlanError } from './plan';
import { runWrites, type WriteIO } from './writes';

export interface EditOutcome {
  ok: boolean;
  /** What to tell the user: the result, or why nothing (or not everything) was done. */
  message: string;
  /** The note an edit created, when it created one. */
  created?: { id: string; path: string };
}

export async function performIntent(intent: Intent, env: EditEnv, io: WriteIO): Promise<EditOutcome> {
  const plan = planIntent(intent, env);
  if (isPlanError(plan)) return { ok: false, message: plan.error };
  if (!plan.writes.length) return { ok: true, message: plan.notice };
  const { written, error } = await runWrites(plan.writes, io);
  if (error === null) return { ok: true, message: plan.notice, ...(plan.created ? { created: plan.created } : {}) };
  const reason = error instanceof Error && error.message ? error.message : String(error);
  return {
    ok: false,
    message: `Edit failed: ${reason}.` + (written.length ? ` Already written (not rolled back): ${written.join(', ')}.` : ' Nothing was changed.'),
  };
}
