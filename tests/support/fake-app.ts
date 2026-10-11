import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { Events, TFile } from '../mocks/obsidian';

/** Minimal TFile look-alike: the fields the plugin reads. */
export interface FakeFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

export interface FakeFolder {
  path: string;
  children: true;
}

export type VaultOp =
  | { op: 'createFolder'; path: string }
  | { op: 'create'; path: string }
  | { op: 'processFrontMatter'; path: string; changed: boolean }
  | { op: 'openFile'; path: string };

function makeFile(path: string): FakeFile {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return Object.assign(new TFile(), {
    path,
    name,
    basename: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot + 1) : '',
  });
}

/**
 * In-memory vault with just enough of Obsidian's Vault API for the plugin.
 * Every mutating call is appended to `ops`, so two implementations can be
 * compared on the exact sequence of writes, not only on the end state.
 */
export class FakeVault extends Events {
  readonly contents = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly ops: VaultOp[] = [];
  private readonly files = new Map<string, FakeFile>();

  /** Make `create` throw for this path, to exercise partial-failure handling. */
  failCreateOn: string | null = null;

  constructor(initial: Record<string, string> = {}, folders: string[] = []) {
    super();
    for (const [path, content] of Object.entries(initial)) this.addFile(path, content);
    for (const folder of folders) this.addFolder(folder);
  }

  private addFolder(path: string): void {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
  }

  private addFile(path: string, content: string): FakeFile {
    const file = makeFile(path);
    this.files.set(path, file);
    this.contents.set(path, content);
    if (path.includes('/')) this.addFolder(path.slice(0, path.lastIndexOf('/')));
    return file;
  }

  getMarkdownFiles(): FakeFile[] {
    return Array.from(this.files.values()).filter((f) => f.extension === 'md');
  }

  getAbstractFileByPath(path: string): FakeFile | FakeFolder | null {
    const file = this.files.get(path);
    if (file) return file;
    if (this.folders.has(path)) return { path, children: true };
    return null;
  }

  async createFolder(path: string): Promise<void> {
    this.ops.push({ op: 'createFolder', path });
    if (this.folders.has(path) || this.files.has(path)) throw new Error('Folder already exists.');
    this.addFolder(path);
  }

  async create(path: string, content: string): Promise<FakeFile> {
    this.ops.push({ op: 'create', path });
    if (this.failCreateOn === path) throw new Error('Simulated write failure.');
    if (this.files.has(path)) throw new Error('File already exists.');
    return this.addFile(path, content);
  }

  /**
   * Stand-in for `fileManager.processFrontMatter`: parse the frontmatter, hand the object to `fn`,
   * and write it back only when `fn` changed it. Real Obsidian re-dumps the YAML its own way, so
   * the goldens pin what the plugin changes, not Obsidian's exact formatting (manual check).
   */
  async processFrontMatter(file: FakeFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> {
    const before = this.contents.get(file.path);
    if (before === undefined) throw new Error('File does not exist: ' + file.path);
    const block = /^---\n([\s\S]*?)\n---\n?/.exec(before);
    const frontmatter = ((block ? parse(block[1]) : null) ?? {}) as Record<string, unknown>;
    const snapshot = JSON.stringify(frontmatter);
    fn(frontmatter);
    const changed = JSON.stringify(frontmatter) !== snapshot;
    if (changed) {
      const rest = block ? before.slice(block[0].length) : before;
      this.contents.set(file.path, '---\n' + stringify(frontmatter, { lineWidth: 0 }) + '---\n' + rest);
    }
    this.ops.push({ op: 'processFrontMatter', path: file.path, changed });
  }

  file(path: string): FakeFile {
    const file = this.files.get(path);
    if (!file) throw new Error('FakeVault: no file at ' + path);
    return file;
  }
}

export interface FakeApp {
  vault: FakeVault;
  fileManager: { processFrontMatter: FakeVault['processFrontMatter'] };
  workspace: {
    getLeaf(newLeaf?: boolean | string): { view: unknown; openFile(file: FakeFile): Promise<void> };
    getLeavesOfType(type: string): unknown[];
    getActiveFile(): FakeFile | null;
  };
}

/** Just enough of `App` for the create flows, and for the graph commands to open a file (no view is created). */
export function makeApp(vault: FakeVault): FakeApp {
  return {
    vault,
    fileManager: { processFrontMatter: (file, fn) => vault.processFrontMatter(file, fn) },
    workspace: {
      getLeaf() {
        return {
          view: null,
          async openFile(file: FakeFile) {
            vault.ops.push({ op: 'openFile', path: file.path });
          },
        };
      },
      getLeavesOfType: () => [],
      getActiveFile: () => null,
    },
  };
}

export const TEST_VAULT_DIR = new URL('../../test-vault/', import.meta.url).pathname;

/** Every file in test-vault/ except Obsidian's own config folder, as path → content. */
export function readTestVault(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.obsidian') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[relative(TEST_VAULT_DIR, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(TEST_VAULT_DIR);
  return out;
}

export function testVault(): FakeVault {
  return new FakeVault(readTestVault());
}
