import { Component, FileView, MarkdownRenderer, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import { GraphSession, type GraphState } from '../core/graph-session';
import { changesGraph } from '../core/edits';
import { performIntent } from '../core/perform';
import { splitFrontmatter } from '../core/writes';
import { mountGraph, type GraphHost, type MountedGraph } from '../ui/mount';
import { ObsidianAdapter } from './adapter';
import { ObsidianIO } from './io';
import { today } from './today';

export const VIEW_TYPE = 'strategy-graph';
export const GSMAP_EXTENSION = 'gsmap';

export type MountFn = (el: HTMLElement, host: GraphHost) => MountedGraph;

/**
 * A `.gsmap` file opened as the strategy graph (plan Phase 5a). The graph itself is always
 * re-derived from the notes' frontmatter through `metadataCache`; the file holds positions only.
 *
 * Lifecycle: vault and cache events are registered on the view (`registerEvent`), so Obsidian
 * drops them when the tab closes. Each loaded file gets its own GraphSession and React root;
 * unloading the file (switching files or closing the tab) unmounts React and writes any moved
 * positions still pending before the file is let go.
 */
export class StrategyGraphView extends FileView {
  private session: GraphSession | null = null;
  private mounted: MountedGraph | null = null;
  private state: GraphState | null = null;
  private reveal: { key: string; nonce: number } | null = null;
  /** A reveal asked for before the first build finished. */
  private pendingReveal: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly mount: MountFn = mountGraph) {
    super(leaf);
    this.icon = 'network';
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Strategy graph';
  }

  canAcceptExtension(extension: string): boolean {
    return extension === GSMAP_EXTENSION;
  }

  async onOpen(): Promise<void> {
    const { vault, metadataCache } = this.app;
    // Any note can matter (a link target outside Strategy/ too), and an unchanged graph doesn't re-render.
    this.registerEvent(metadataCache.on('changed', () => this.session?.requestRebuild()));
    this.registerEvent(metadataCache.on('deleted', () => this.session?.requestRebuild()));
    // Fired once link resolution has caught up, e.g. after a rename or at startup.
    this.registerEvent(metadataCache.on('resolved', () => this.session?.requestRebuild()));
    this.registerEvent(
      vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') this.session?.rename(oldPath, file.path);
      })
    );
    this.registerEvent(
      vault.on('modify', (file) => {
        if (file === this.file && file instanceof TFile) void this.reloadMap(file);
      })
    );
  }

  async onLoadFile(file: TFile): Promise<void> {
    await this.teardown();
    const session = new GraphSession({
      adapter: new ObsidianAdapter(this.app),
      write: (edit) => this.app.vault.process(file, edit),
      onUpdate: (state) => this.render(state),
      onIdChange: (message) => new Notice(message, 10000),
      onWriteError: (error) => {
        console.error('strategy graph: saving positions failed', error);
        new Notice(`Strategy graph: positions not saved. ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    this.session = session;
    this.contentEl.empty();
    this.mounted = this.mount(this.contentEl, {
      move: (updates) => {
        const saved = session.move(updates);
        if (!saved) new Notice(`Strategy graph: ${file.name} can't be read, so positions are not saved.`);
        return saved;
      },
      editMap: (op) => {
        const saved = session.editMap(op);
        if (!saved) new Notice(`Strategy graph: ${file.name} can't be read, so this change was not saved.`);
        return saved;
      },
      resetPositions: () => {
        const saved = session.resetPositions();
        if (!saved) new Notice(`Strategy graph: ${file.name} can't be read, so positions can't be reset.`);
        return saved;
      },
      openNote: (path, newTab) => this.openNote(path, newTab),
      hoverNote: (event, targetEl, path) =>
        this.app.workspace.trigger('hover-link', { event, source: VIEW_TYPE, hoverParent: this, targetEl, linktext: path }),
      today,
      edit: async (intent) => {
        const graph = session.state.graph;
        if (!graph) return { ok: false, message: 'The graph has not been read yet.' };
        const outcome = await performIntent(intent, { graph, vault: this.app.vault, today: today() }, new ObsidianIO(this.app));
        // The next edit is planned from the graph: let it see this one first (Obsidian's cache lags a write).
        if (outcome.ok && changesGraph(intent)) await session.settle();
        return outcome;
      },
      readNote: (path) => {
        const note = this.app.vault.getAbstractFileByPath(path);
        return note instanceof TFile ? this.app.vault.read(note) : Promise.reject(new Error('Not a note: ' + path));
      },
      renderNote: (el, path) => this.renderNote(el, path),
    });
    session.loadMap(await this.app.vault.read(file));
    await session.rebuild();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    await this.teardown();
  }

  async onClose(): Promise<void> {
    await this.teardown();
    await super.onClose();
  }

  /** Center on the node of the note at `path` and select it. False (with a notice) when it isn't on the graph. */
  revealPath(path: string): boolean {
    if (!this.state?.graph) {
      this.pendingReveal = path;
      return true;
    }
    const node = this.state.graph.nodes.find((n) => n.path === path);
    if (!node) {
      new Notice(`Not on the strategy graph: ${path}`);
      return false;
    }
    this.reveal = { key: node.key, nonce: (this.reveal?.nonce ?? 0) + 1 };
    this.mounted?.render(this.state, this.reveal);
    return true;
  }

  private render(state: GraphState): void {
    this.state = state;
    this.mounted?.render(state, this.reveal);
    if (state.graph && this.pendingReveal !== null) {
      const path = this.pendingReveal;
      this.pendingReveal = null;
      this.revealPath(path);
    }
  }

  /** The note's body (its frontmatter is shown as fields instead) rendered as in reading view; returns the cleanup. */
  private renderNote(el: HTMLElement, path: string): () => void {
    const component = new Component();
    component.load();
    let disposed = false;
    const note = this.app.vault.getAbstractFileByPath(path);
    if (note instanceof TFile) {
      void this.app.vault
        .read(note)
        // Selecting another note meanwhile unloaded the component: rendering into it now would leak its children.
        .then((text) => (disposed ? undefined : MarkdownRenderer.render(this.app, splitFrontmatter(text).body, el, path, component)))
        .catch((error) => console.error('strategy graph: rendering the note failed', error));
    }
    return () => {
      disposed = true;
      component.unload();
    };
  }

  private async reloadMap(file: TFile): Promise<void> {
    const session = this.session;
    const text = await this.app.vault.read(file);
    if (session === this.session) session?.loadMap(text);
  }

  private openNote(path: string, newTab: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    // Never in the graph's own tab.
    if (file instanceof TFile) void this.app.workspace.getLeaf(newTab ? 'split' : 'tab').openFile(file);
  }

  /** Unmount React, stop the session and write what it still holds. Idempotent. */
  private async teardown(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.state = null;
    this.reveal = null;
    this.pendingReveal = null;
    this.mounted?.unmount();
    this.mounted = null;
    await session?.dispose();
  }
}
