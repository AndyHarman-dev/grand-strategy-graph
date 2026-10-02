import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readVaultFiles } from '../../tools/fs-adapter';
import { runMigrate, type CliIo } from '../../tools/migrate/cli';
import { TEST_VAULT_DIR } from '../support/fake-app';

const FIXTURE = new URL('./fixtures/test-vault.resolutions.yaml', import.meta.url).pathname;
const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'apply-'));
  temps.push(dir);
  return dir;
};
afterEach(() => temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function io() {
  const lines: string[] = [];
  const errors: string[] = [];
  const value: CliIo = { log: (l) => lines.push(l), error: (l) => errors.push(l), now: () => new Date('2026-10-02T10:00:00Z') };
  return { io: value, lines, errors };
}

/** A throwaway copy of the synthetic vault, its dry-run outputs, and an empty backup root. All outside the repo. */
async function dryRunOnCopy() {
  const base = temp();
  const vault = join(base, 'vault');
  cpSync(TEST_VAULT_DIR, vault, { recursive: true, verbatimSymlinks: true });
  const out = join(base, 'out');
  const backups = join(base, 'backups');
  expect(await runMigrate(['--vault', vault, '--out', out, '--resolutions', FIXTURE], io().io)).toBe(0);
  const apply = (extra: string[] = []) => {
    const t = io();
    return runMigrate(['--vault', vault, '--out', out, '--resolutions', FIXTURE, '--apply', '--backup-dir', backups, ...extra], t.io).then((code) => ({ code, ...t }));
  };
  return { vault, out, backups, apply, original: readVaultFiles(vault) };
}

describe('npm run migrate --apply', () => {
  it('backs up, writes exactly the planned files, leaves the canvas alone, and the re-check passes', async () => {
    const { vault, out, backups, apply, original } = await dryRunOnCopy();
    const r = await apply();
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);

    const after = readVaultFiles(vault);
    const plan = JSON.parse(readFileSync(join(out, 'migration-plan.json'), 'utf8')) as { files: { path: string }[] };
    const touched = new Set(plan.files.map((f) => f.path));
    expect(touched.size).toBe(21);
    for (const path of Object.keys(after)) {
      if (touched.has(path)) expect(after[path], path).not.toBe(original[path]);
      else expect(after[path], path).toBe(original[path]);
    }
    expect(after['Strategy/Strategy.gsmap']).toBeDefined();
    expect(after['Strategy/The Map.canvas']).toBe(original['Strategy/The Map.canvas']);
    expect(Object.keys(after).filter((p) => p.endsWith('.migrate-tmp'))).toEqual([]);

    // The backup holds the pre-migration bytes of everything that was overwritten, plus the canvas and the phantom root file.
    const [stamp] = readdirSync(backups);
    expect(stamp).toBe('2026-10-02T10-00-00-000Z');
    const backup = readVaultFiles(join(backups, stamp));
    for (const path of touched) if (original[path] !== undefined) expect(backup[path], path).toBe(original[path]);
    expect(backup['Strategy/The Map.canvas']).toBe(original['Strategy/The Map.canvas']);
    expect(Object.keys(backup)).toContain('FP-2 Profitable pottery business.md');
    expect(Object.keys(backup)).not.toContain('Strategy/Strategy.gsmap');

    const applied = JSON.parse(readFileSync(join(out, 'migration-applied.json'), 'utf8'));
    expect(applied.ok).toBe(true);
    expect(applied.written).toHaveLength(21);
  });

  it('after applying, a fresh dry run plans nothing and a second apply is refused (the reviewed plan is stale)', async () => {
    const { vault, out, apply } = await dryRunOnCopy();
    expect(await apply().then((r) => r.code)).toBe(0);
    const fresh = join(temp(), 'out2');
    const t = io();
    expect(await runMigrate(['--vault', vault, '--out', fresh, '--resolutions', FIXTURE], t.io)).toBe(0);
    expect(t.lines.join('\n')).toContain('0 files to change');
    const again = await apply();
    expect(again.code).toBe(2);
    expect(again.errors.join('\n')).toContain('no longer planned');
    expect(existsSync(join(out, 'migration-plan.json'))).toBe(true);
  });

  it('writes nothing if a touched file changed after the dry run', async () => {
    const { vault, backups, apply, original } = await dryRunOnCopy();
    const bet = join(vault, 'Strategy/Bets/B-1 Get a D7 visa.md');
    const path = 'Strategy/Bets/B-1 Get a D7 visa.md';
    expect(original[path], 'fixture note exists and is planned').toBeDefined();
    writeFileSync(bet, original[path] + '\nA late edit.\n');
    const edited = readVaultFiles(vault);
    const r = await apply();
    expect(r.code).toBe(2);
    expect(r.errors.join('\n')).toMatch(/content changed since the dry run|differs from the reviewed dry run/);
    expect(readVaultFiles(vault)).toEqual(edited);
    expect(existsSync(backups)).toBe(false);
  });

  it('refuses a gate that is not passing (unanswered questions), a missing plan, and a backup folder inside the vault', async () => {
    const { vault, out, apply, original } = await dryRunOnCopy();
    // No --resolutions: open questions.
    const t = io();
    const open = await runMigrate(['--vault', vault, '--out', out, '--apply', '--backup-dir', join(temp(), 'b')], t.io);
    expect(open).toBe(2);
    expect(t.errors.join('\n')).toContain('parity gate is "open"');

    const inside = await apply(['--backup-dir', join(vault, 'backups')]);
    expect(inside.code).toBe(2);
    expect(inside.errors.join('\n')).toContain('inside the vault');

    const missing = await apply(['--plan', join(out, 'nope.json')]);
    expect(missing.code).toBe(2);
    expect(missing.errors.join('\n')).toContain('Run the dry run first');
    expect(readVaultFiles(vault)).toEqual(original);
  });

  it('refuses a plan whose dry run did not pass', async () => {
    const { vault, out, apply, original } = await dryRunOnCopy();
    const file = join(out, 'migration-plan.json');
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...plan, verdict: 'open' }));
    const r = await apply();
    expect(r.code).toBe(2);
    expect(r.errors.join('\n')).toContain('verdict was "open"');
    expect(readVaultFiles(vault)).toEqual(original);
  });

  it('refuses when the planned content no longer matches the reviewed dry run', async () => {
    const { vault, out, apply, original } = await dryRunOnCopy();
    const file = join(out, 'migration-plan.json');
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    plan.files[0].after = '0'.repeat(64);
    writeFileSync(file, JSON.stringify(plan));
    const r = await apply();
    expect(r.code).toBe(2);
    expect(r.errors.join('\n')).toContain('planned content differs');
    expect(readVaultFiles(vault)).toEqual(original);
  });

  it("refuses when a file's hash differs from the reviewed dry run even though its planned content is unchanged", async () => {
    const { vault, out, backups, apply, original } = await dryRunOnCopy();
    const file = join(out, 'migration-plan.json');
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    const entry = plan.files.find((f: { before: string | null }) => f.before !== null);
    entry.before = '1'.repeat(64);
    writeFileSync(file, JSON.stringify(plan));
    const r = await apply();
    expect(r.code).toBe(2);
    expect(r.errors.join('\n')).toContain(`${entry.path}: content changed since the dry run`);
    expect(readVaultFiles(vault)).toEqual(original);
    expect(existsSync(backups)).toBe(false);
  });
});
