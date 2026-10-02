import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readVaultFiles } from '../../tools/fs-adapter';
import { runMigrate, type CliIo } from '../../tools/migrate/cli';
import { TEST_VAULT_DIR } from '../support/fake-app';

const FIXTURE = new URL('./fixtures/test-vault.resolutions.yaml', import.meta.url).pathname;
const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
  temps.push(dir);
  return dir;
};
afterEach(() => temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function io() {
  const lines: string[] = [];
  const errors: string[] = [];
  const value: CliIo = { log: (l) => lines.push(l), error: (l) => errors.push(l), now: () => new Date('2026-10-01T00:00:00Z') };
  return { io: value, lines, errors };
}

/** Hash of every file in a folder (including .obsidian), to prove nothing was written. */
function fingerprint(dir: string): string {
  const files = readVaultFiles(dir);
  return createHash('sha256').update(JSON.stringify(Object.entries(files).sort())).digest('hex');
}

describe('npm run migrate (dry run)', () => {
  it('writes the five outputs outside the vault and nothing inside it', async () => {
    const vault = join(temp(), 'vault');
    cpSync(TEST_VAULT_DIR, vault, { recursive: true, dereference: false, verbatimSymlinks: true });
    const before = fingerprint(vault);
    const out = join(temp(), 'out');
    const t = io();
    expect(await runMigrate(['--vault', vault, '--out', out], t.io)).toBe(1);
    expect(fingerprint(vault)).toBe(before);
    for (const name of ['migration-report.md', 'resolutions.yaml', 'migration.diff', 'legacy-edges.json', 'migration-plan.json']) {
      expect(existsSync(join(out, name)), name).toBe(true);
    }
    expect(t.lines[t.lines.length - 1]).toContain('Answer the open questions');
    const planJson = JSON.parse(readFileSync(join(out, 'migration-plan.json'), 'utf8'));
    expect(planJson.files).toHaveLength(21);
    expect(planJson.files.find((f: { path: string }) => f.path === 'Strategy/Strategy.gsmap').before).toBeNull();
    expect(JSON.parse(readFileSync(join(out, 'legacy-edges.json'), 'utf8'))).toHaveLength(54);
  });

  it('passes the gate with the fixture answers, and carries answers over when its own file is passed back', async () => {
    const out = temp();
    expect(await runMigrate(['--vault', TEST_VAULT_DIR, '--out', out, '--resolutions', FIXTURE], io().io)).toBe(0);
    const written = readFileSync(join(out, 'resolutions.yaml'), 'utf8');
    expect(written).toContain('answer:\n      retarget: "[[A-7 Workshops can fill eight seats]]"');
    const again = temp();
    writeFileSync(join(again, 'answers.yaml'), written);
    expect(await runMigrate(['--vault', TEST_VAULT_DIR, '--out', again, `--resolutions=${join(again, 'answers.yaml')}`], io().io)).toBe(0);
    expect(readFileSync(join(again, 'migration.diff'), 'utf8')).toBe(readFileSync(join(out, 'migration.diff'), 'utf8'));
  });

  it('refuses --apply, an output folder inside the vault, a missing vault and unknown options', async () => {
    const vault = join(temp(), 'vault');
    cpSync(TEST_VAULT_DIR, vault, { recursive: true, verbatimSymlinks: true });
    const before = fingerprint(vault);
    const cases: [string[], string][] = [
      [['--vault', vault, '--apply'], 'Phase 3'],
      [['--vault', vault, '--out', join(vault, 'reports')], 'outside the vault'],
      [['--vault', vault, '--out', vault], 'outside the vault'],
      [['--vault', join(vault, 'nope')], 'not found'],
      [['--out', temp()], '--vault <path> is required'],
      [['--vault', vault, '--dry'], 'Unknown option'],
    ];
    for (const [argv, message] of cases) {
      const t = io();
      expect(await runMigrate(argv, t.io), argv.join(' ')).toBe(2);
      expect(t.errors.join('\n')).toContain(message);
    }
    expect(fingerprint(vault)).toBe(before);
    expect(existsSync(join(vault, 'reports'))).toBe(false);
  });
});
