import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readVaultFiles } from '../fs-adapter';
import { unifiedDiff } from './diff';
import { parityGate } from './parity';
import { planMigration } from './plan';
import { parseResolutions, renderReport, renderResolutions, verdictOf, type Verdict } from './report';

export const USAGE = `Usage: npm run migrate -- --vault <path> [--resolutions <file>] [--out <dir>]

Dry run of the schema v2 migration (plan Phase 2). Reads the vault, writes nothing to it.
Writes to --out (default: ./migration-out, which must be outside the vault):
  migration-report.md   every legacy edge and its fate, open questions, parity gate
  resolutions.yaml      every open question; answer them and pass the file back with --resolutions
  migration.diff        the planned new content of every touched file
  legacy-edges.json     the parity oracle: every legacy edge as found
  migration-plan.json   sha256 of every touched file before/after (Phase 3 guards its writes on these)

Exit code: 0 parity gate passed · 1 open questions · 2 stop (unclassified data, refused file, or gate failure).
--apply is Phase 3 and is refused here.`;

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
  now(): Date;
}

const defaultIo: CliIo = { log: (l) => console.log(l), error: (l) => console.error(l), now: () => new Date() };

function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}".`);
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) args[name] = inline;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[name] = argv[++i];
    else args[name] = true;
  }
  return args;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Returns the exit code. */
export async function runMigrate(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let args: Record<string, string | true>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const known = new Set(['vault', 'resolutions', 'out', 'apply', 'help']);
  const unknown = Object.keys(args).filter((k) => !known.has(k));
  if (args.help) {
    io.log(USAGE);
    return 0;
  }
  if (unknown.length) {
    io.error(`Unknown option(s): ${unknown.map((k) => '--' + k).join(', ')}\n\n${USAGE}`);
    return 2;
  }
  if (args.apply) {
    io.error('--apply is Phase 3 (hash-guarded, with a backup outside the vault) and is not implemented. Nothing was written.');
    return 2;
  }
  if (typeof args.vault !== 'string') {
    io.error(`--vault <path> is required.\n\n${USAGE}`);
    return 2;
  }
  const vault = resolve(args.vault);
  if (!existsSync(vault) || !statSync(vault).isDirectory()) {
    io.error(`Vault folder not found: ${vault}`);
    return 2;
  }
  const out = resolve(typeof args.out === 'string' ? args.out : 'migration-out');
  const rel = relative(vault, out);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    io.error(`--out must be outside the vault (${out} is inside ${vault}): Obsidian would index the report and its links.`);
    return 2;
  }

  let resolutions: Record<string, unknown> = {};
  const resolutionsFile = typeof args.resolutions === 'string' ? resolve(args.resolutions) : null;
  if (resolutionsFile) {
    try {
      resolutions = parseResolutions(readFileSync(resolutionsFile, 'utf8'));
    } catch (e) {
      io.error(`Can't read ${resolutionsFile}: ${(e as Error).message}`);
      return 2;
    }
  }

  const files = readVaultFiles(vault, (path) => /\.(md|canvas|gsmap)$/.test(path));
  const plan = planMigration(files, { resolutions });
  const gate = await parityGate(files, plan);
  const generatedAt = io.now().toISOString();
  const verdict: Verdict = verdictOf(gate);

  mkdirSync(out, { recursive: true });
  const write = (name: string, text: string) => writeFileSync(join(out, name), text, 'utf8');
  write('legacy-edges.json', JSON.stringify(plan.oracle, null, 2) + '\n');
  write('migration-report.md', renderReport(plan, gate, { vault, generatedAt, resolutionsFile }));
  write('resolutions.yaml', renderResolutions(plan, resolutions, generatedAt));
  write('migration.diff', plan.changes.map((c) => unifiedDiff(c.path, c.before, c.after)).join('\n'));
  write(
    'migration-plan.json',
    JSON.stringify(
      {
        generatedAt,
        verdict,
        files: plan.changes.map((c) => ({ path: c.path, before: c.before === null ? null : sha256(c.before), after: sha256(c.after) })),
      },
      null,
      2
    ) + '\n'
  );

  const open = plan.ambiguities.filter((a) => !a.resolved).length;
  io.log(`Dry run of ${vault} — nothing written to the vault.`);
  io.log(`${plan.edges.length} legacy edges, ${plan.changes.length} files to change, ${open} open question(s) of ${plan.ambiguities.length}.`);
  for (const c of gate.checks) io.log(`${c.passed ? 'ok  ' : 'FAIL'} ${c.title}${c.passed ? '' : ` (${c.failures.length})`}`);
  io.log(`Outputs in ${out}`);
  const message = {
    stop: 'STOP: unclassified legacy data or a refused file. See the report; this needs a decision, not a resolution.',
    open: 'Answer the open questions in resolutions.yaml, then re-run with --resolutions.',
    'gate-failed': 'Parity gate failed: planner bug, do not apply.',
    passed: 'Parity gate passed.',
  }[verdict];
  (verdict === 'passed' || verdict === 'open' ? io.log : io.error)(message);
  return verdict === 'passed' ? 0 : verdict === 'open' ? 1 : 2;
}
