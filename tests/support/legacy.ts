import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as obsidian from '../mocks/obsidian';

/**
 * Loads the pre-port plugin (tests/legacy/main.js) with the obsidian mock and
 * exposes its module-private functions and classes, so the characterization
 * tests can run the original code as the oracle. The file itself is kept
 * byte-for-byte as it shipped; the hook is appended only at load time.
 */
const INTERNALS = [
  'getFilesInFolders',
  'FilePickerModal',
  'BetModal',
  'AssumptionModal',
  'sanitizeTitle',
  'trimTrailingPunctuation',
  'deriveAssumptionTitle',
  'parseIds',
  'insertIntoSection',
  'yamlString',
  'stripTrailingColon',
  'buildAssumptionContent',
  'buildBetContent',
  'ensureFolder',
  'buildWritePlan',
  'createBetFromForm',
  'buildAssumptionWritePlan',
  'createAssumptionFromForm',
  'FIXED_POINTS_FOLDER',
  'BETS_FOLDER',
  'ASSUMPTIONS_FOLDER',
  'DEPENDED_ON_BY_HEADING',
  'BET_ASSUMPTIONS_HEADING',
  'ASSUMPTION_TITLE_MAX_LEN',
];

const source = readFileSync(new URL('../legacy/main.js', import.meta.url), 'utf8');
const nodeRequire = createRequire(import.meta.url);
const legacyModule: { exports: any } = { exports: {} };
const legacyRequire = (id: string) => (id === 'obsidian' ? obsidian : nodeRequire(id));

new Function('require', 'module', 'exports', source + '\n;module.exports.__internals = {' + INTERNALS.join(',') + '};')(
  legacyRequire,
  legacyModule,
  legacyModule.exports
);

export const LegacyPlugin = legacyModule.exports;
export const legacy: Record<string, any> = legacyModule.exports.__internals;
