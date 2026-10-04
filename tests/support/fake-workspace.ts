/**
 * A fake Obsidian app for the graph view: a vault and metadata cache that emit the events the
 * view listens to, `vault.process`, and leaves that run a view through its lifecycle in the
 * order Obsidian does (load, onOpen, onLoadFile … onUnloadFile, onClose, unload). The React
 * mount is replaced by a recorder, so these tests run in Node without a DOM.
 */
import { parseFrontmatter } from '../../src/core/frontmatter';
import { resolveLinkpath } from '../../src/core/links';
import type { GraphState } from '../../src/core/graph-session';
import type { GraphHost, MountedGraph } from '../../src/ui/mount';
import { StrategyGraphView } from '../../src/obsidian/graph-view';
import { MemoryVault } from '../../src/core/memory-vault';
import { Events, TFile } from '../mocks/obsidian';

export interface FakeFile extends TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

function makeFile(path: string): FakeFile {
  const file = new TFile() as FakeFile;
  setPath(file, path);
  return file;
}

function setPath(file: FakeFile, path: string): void {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  Object.assign(file, { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '' });
}

export class FakeWorkspaceVault extends Events {
  readonly files = new Map<string, { file: FakeFile; text: string }>();
  readonly folders = new Set<string>();
  /** Every `process` call, with the text before and after. */
  readonly processed: { path: string; before: string; after: string }[] = [];
  failProcess = false;

  constructor(initial: Record<string, string>) {
    super();
    for (const [path, text] of Object.entries(initial)) this.files.set(path, { file: makeFile(path), text });
  }

  getFiles(): FakeFile[] {
    return Array.from(this.files.values(), (f) => f.file);
  }

  getMarkdownFiles(): FakeFile[] {
    return Array.from(this.files.values(), (f) => f.file).filter((f) => f.extension === 'md');
  }

  getAbstractFileByPath(path: string): FakeFile | { path: string } | null {
    if (this.files.has(path)) return this.files.get(path)!.file;
    if (this.folders.has(path) || Array.from(this.files.keys()).some((p) => p.startsWith(path + '/'))) return { path };
    return null;
  }

  text(path: string): string {
    const entry = this.files.get(path);
    if (!entry) throw new Error('no file ' + path);
    return entry.text;
  }

  async read(file: FakeFile): Promise<string> {
    return this.text(file.path);
  }

  async process(file: FakeFile, fn: (text: string) => string): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error('File does not exist: ' + file.path);
    if (this.failProcess) throw new Error('Simulated write failure.');
    const after = fn(entry.text);
    this.processed.push({ path: file.path, before: entry.text, after });
    entry.text = after;
    this.trigger('modify', file);
    return after;
  }

  async create(path: string, text: string): Promise<FakeFile> {
    if (this.files.has(path)) throw new Error('File already exists.');
    const file = makeFile(path);
    this.files.set(path, { file, text });
    return file;
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  // ---- test drivers: what the user or Sync does

  /** Edit a file from outside the view (the user typing, or Sync). */
  write(path: string, text: string, cache?: FakeMetadataCache): void {
    let entry = this.files.get(path);
    if (!entry) {
      entry = { file: makeFile(path), text };
      this.files.set(path, entry);
    } else entry.text = text;
    this.trigger('modify', entry.file);
    if (cache && entry.file.extension === 'md') cache.changed(entry.file);
  }

  rename(oldPath: string, newPath: string, cache?: FakeMetadataCache): void {
    const entry = this.files.get(oldPath)!;
    this.files.delete(oldPath);
    setPath(entry.file, newPath);
    this.files.set(newPath, entry);
    this.trigger('rename', entry.file, oldPath);
    cache?.changed(entry.file);
  }

  remove(path: string, cache?: FakeMetadataCache): void {
    const entry = this.files.get(path)!;
    this.files.delete(path);
    this.trigger('delete', entry.file);
    if (cache) {
      cache.trigger('deleted', entry.file, null);
      cache.trigger('resolved');
    }
  }
}

export class FakeMetadataCache extends Events {
  constructor(private readonly vault: FakeWorkspaceVault) {
    super();
  }

  getFileCache(file: FakeFile): { frontmatter?: Record<string, unknown> } | null {
    const entry = this.vault.files.get(file.path);
    if (!entry || file.extension !== 'md') return null;
    const { frontmatter } = parseFrontmatter(entry.text);
    return Object.keys(frontmatter).length ? { frontmatter: { ...frontmatter, position: { start: 0, end: 0 } } } : {};
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): FakeFile | null {
    const path = resolveLinkpath(linkpath, sourcePath, Array.from(this.vault.files.keys()));
    return path ? this.vault.files.get(path)!.file : null;
  }

  changed(file: FakeFile): void {
    this.trigger('changed', file, this.vault.text(file.path), this.getFileCache(file));
    this.trigger('resolved');
  }
}

/** What the view handed to React, and whether it was unmounted. */
export interface MountRecord {
  host: GraphHost;
  renders: { state: GraphState; reveal: { key: string; nonce: number } | null }[];
  unmounted: boolean;
}

export class FakeLeaf {
  view: StrategyGraphView | null = null;
  detached = false;

  constructor(readonly app: FakeWorkspaceApp) {}

  async loadIfDeferred(): Promise<void> {}

  async openFile(file: FakeFile): Promise<void> {
    if (this.view?.file === file) return;
    if (this.view && this.view.file) await this.view.onUnloadFile(this.view.file as never);
    if (!this.view) {
      this.view = new StrategyGraphView(this as never, (_el, host) => this.app.recordMount(host));
      this.view.load();
      await (this.view as unknown as { onOpen(): Promise<void> }).onOpen();
    }
    this.view.file = file as never;
    await this.view.onLoadFile(file as never);
  }

  /** Close the tab. */
  async detach(): Promise<void> {
    const view = this.view!;
    if (view.file) await view.onUnloadFile(view.file as never);
    await (view as unknown as { onClose(): Promise<void> }).onClose();
    view.unload();
    this.detached = true;
    this.app.leaves = this.app.leaves.filter((l) => l !== this);
  }
}

export class FakeWorkspaceApp {
  readonly vault: FakeWorkspaceVault;
  readonly metadataCache: FakeMetadataCache;
  leaves: FakeLeaf[] = [];
  readonly mounts: MountRecord[] = [];
  readonly opened: { path: string; how: unknown }[] = [];
  readonly revealed: FakeLeaf[] = [];
  /** Every `workspace.trigger` call: the hover-link events the graph raises for page preview. */
  readonly triggered: { name: string; args: unknown[] }[] = [];
  activeFile: FakeFile | null = null;
  readonly workspace = {
    getLeavesOfType: (type: string) => this.leaves.filter((l) => l.view?.getViewType() === type),
    getLeaf: (how?: unknown) => {
      // Notes open in a leaf of their own (recorded); a .gsmap opens in a new graph leaf.
      const app = this;
      const leaf = new FakeLeaf(this);
      return {
        get view() {
          return leaf.view;
        },
        async openFile(file: FakeFile) {
          if (file.extension !== 'gsmap') {
            app.opened.push({ path: file.path, how });
            return;
          }
          app.leaves.push(leaf);
          await leaf.openFile(file);
        },
      };
    },
    revealLeaf: async (leaf: FakeLeaf) => {
      this.revealed.push(leaf);
    },
    getActiveFile: () => this.activeFile,
    trigger: (name: string, ...args: unknown[]) => void this.triggered.push({ name, args }),
  };

  /** Obsidian's `processFrontMatter`: the same edit the dev page's MemoryVault makes, then a modify and a cache change like the real one. */
  readonly fileManager = {
    processFrontMatter: async (file: FakeFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> => {
      const scratch = { [file.path]: this.vault.text(file.path) };
      await new MemoryVault(scratch).patchFrontmatter(file.path, fn);
      if (scratch[file.path] !== this.vault.text(file.path)) this.vault.write(file.path, scratch[file.path], this.metadataCache);
    },
  };

  constructor(files: Record<string, string>) {
    this.vault = new FakeWorkspaceVault(files);
    this.metadataCache = new FakeMetadataCache(this.vault);
  }

  recordMount(host: GraphHost): MountedGraph {
    const record: MountRecord = { host, renders: [], unmounted: false };
    this.mounts.push(record);
    return {
      render: (state, reveal = null) => {
        if (record.unmounted) throw new Error('render after unmount');
        record.renders.push({ state, reveal });
      },
      unmount: () => {
        if (record.unmounted) throw new Error('unmounted twice');
        record.unmounted = true;
      },
    };
  }

  file(path: string): FakeFile {
    return this.vault.files.get(path)!.file;
  }
}
