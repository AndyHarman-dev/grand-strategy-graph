/**
 * The synthetic test vault, as path → text, for the dev page (`npm run dev:web`) and tests.
 * Node only. Nothing here writes: the migrated form is computed in memory.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readVaultFiles } from './fs-adapter';
import { applyPlan, planMigration } from './migrate/plan';
import { parseResolutions } from './migrate/report';

export const TEST_VAULT_DIR = fileURLToPath(new URL('../test-vault/', import.meta.url));
const RESOLUTIONS = new URL('../tests/migration/fixtures/test-vault.resolutions.yaml', import.meta.url);

/** `test-vault/` as it is on disk: legacy format. */
export function legacyTestVault(): Record<string, string> {
  return readVaultFiles(TEST_VAULT_DIR);
}

/**
 * `test-vault/` after the Phase 2 planner, with the fixture answers: schema v2 notes and the
 * `Strategy.gsmap` carrying the canvas positions. What a migrated vault looks like to the graph.
 */
export function plannedTestVault(): Record<string, string> {
  const files = legacyTestVault();
  const resolutions = parseResolutions(readFileSync(RESOLUTIONS, 'utf8'));
  return applyPlan(files, planMigration(files, { resolutions }));
}
