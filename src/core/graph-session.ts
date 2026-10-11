/**
 * Everything the graph view does that is not Obsidian or React: re-derive the graph from the
 * vault (debounced, newest wins), track ids across rebuilds, keep the `.gsmap` and its pending
 * moves, and turn problems into notices. The Obsidian view (src/obsidian/graph-view.ts) and the
 * dev page (dev/) each wrap one, so the behavior they share is tested once, here.
 */
import type { VaultAdapter } from './adapter';
import { buildGraph } from './graph';
import { renameTouches, type GsMap, type GsOp, type GsPosition } from './gsmap';
import { GsMapStore, type GsMapWriter } from './gsmap-store';
import { describeIdChange, IdTracker } from './id-changes';
import type { Graph } from './schema';

export interface GraphNotice {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The note it is about. */
  path?: string;
  /** A one-click fix: a `.gsmap` edit, offered as a button next to the message. */
  action?: { label: string; op: GsOp };
}

export interface GraphState {
  /** Null until the first build. */
  graph: Graph | null;
  /** Null until the map is loaded, or while it can't be read (`mapError`). */
  map: GsMap | null;
  mapError: string | null;
  notices: GraphNotice[];
}

export interface GraphSessionOptions {
  adapter: VaultAdapter;
  /** Writes the `.gsmap` (see `GsMapWriter`). */
  write: GsMapWriter;
  /** The state changed: render it. Never called after `dispose()`. */
  onUpdate: (state: GraphState) => void;
  /** A note's id changed since the last build (shown on the graph too). */
  onIdChange?: (message: string) => void;
  onWriteError?: (error: unknown) => void;
  /** Quiet time after a vault change before rebuilding. */
  rebuildDelayMs?: number;
  /** Quiet time after a drag before writing the `.gsmap`. */
  saveDelayMs?: number;
}

export class GraphSession {
  private graph: Graph | null = null;
  /** `graph` as JSON, to tell a rebuild that changed nothing (an edit to an unrelated note). */
  private graphText = '';
  private readonly store: GsMapStore;
  private readonly ids = new IdTracker();
  /** Changed ids still in effect, by note path: the original id and the current one. */
  private readonly idNotices = new Map<string, { basename: string; from: string; to: string | null; hadPosition: boolean }>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Callers of `settle()` waiting for the next rebuild that reads the vault after they asked. */
  private waiters: (() => void)[] = [];
  private readonly rebuildDelayMs: number;

  constructor(private readonly options: GraphSessionOptions) {
    this.rebuildDelayMs = options.rebuildDelayMs ?? 250;
    this.store = new GsMapStore({
      write: options.write,
      delayMs: options.saveDelayMs,
      onChange: () => this.emit(),
      onWriteError: (error) => options.onWriteError?.(error),
    });
  }

  get state(): GraphState {
    const notices: GraphNotice[] = [];
    if (this.store.error) {
      notices.push({ severity: 'error', message: `Strategy.gsmap can't be read: ${this.store.error}. Positions are not saved until it is fixed.` });
    }
    for (const [path, change] of this.idNotices) {
      notices.push({ severity: 'warning', path, message: describeIdChange({ path, ...change }, change.hadPosition) });
    }
    // A link on the graph that ends on a note that is gone (deleted, or its id changed): not drawn, so say so.
    if (this.graph && this.store.map) {
      const known = new Set(this.graph.nodes.map((n) => n.key));
      for (const link of this.store.map.links) {
        const missing = [link.from, link.to].flatMap((end) => ('note' in end && !known.has(end.note) ? [end.note] : []));
        if (missing.length) {
          notices.push({
            severity: 'warning',
            message: `A link on the graph${link.label ? ` ("${link.label}")` : ''} ends on ${missing.map((id) => `"${id}"`).join(' and ')}, which is not a note on the graph; it is not drawn.`,
            // It can't be clicked on the graph, so this is the only way to delete it there.
            action: { label: 'Remove link', op: { op: 'delete-link', id: link.id } },
          });
        }
      }
    }
    for (const issue of this.graph?.issues ?? []) {
      notices.push({ severity: issue.severity, path: issue.path, message: `${issue.path}: ${issue.message}` });
    }
    return { graph: this.graph, map: this.store.map, mapError: this.store.error, notices };
  }

  /** The `.gsmap`'s text, on open and after every change to the file. */
  loadMap(text: string): void {
    this.store.load(text);
  }

  /** Something in the vault changed: rebuild after a quiet period. */
  requestRebuild(): void {
    if (this.disposed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuild();
    }, this.rebuildDelayMs);
  }

  /**
   * A vault file or folder was renamed or moved. Positions follow ids, so for a strategy note only the
   * id tracking needs to know; note cards name their file by path, so the ones on it follow (as on a canvas).
   */
  rename(oldPath: string, newPath: string): void {
    this.ids.rename(oldPath, newPath);
    const map = this.store.map;
    if (map && renameTouches(map, oldPath)) this.store.edit({ op: 'rename-file', from: oldPath, to: newPath });
    const notice = this.idNotices.get(oldPath);
    if (notice) {
      this.idNotices.delete(oldPath);
      this.idNotices.set(newPath, notice);
    }
    this.requestRebuild();
  }

  /**
   * Rebuild soon, as a change to a note would, and resolve once that rebuild has read the vault (or
   * after `timeoutMs`). For a caller that has just written notes and plans its next step from the
   * graph: Obsidian's cache catches up with a write a moment later.
   */
  settle(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      const waiter = () => done();
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.waiters.push(waiter);
      this.requestRebuild();
    });
  }

  private releaseWaiters(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const waiter of waiting) waiter();
  }

  /** Rebuild now. If another rebuild starts before this one has read the vault, this one is dropped. */
  async rebuild(): Promise<void> {
    let latest = false;
    try {
      await this.rebuildNow(() => (latest = true));
    } finally {
      // A rebuild that was overtaken leaves the waiters to the newer one.
      if (latest || this.disposed) this.releaseWaiters();
    }
  }

  private async rebuildNow(markLatest: () => void): Promise<void> {
    if (this.disposed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const generation = ++this.generation;
    let graph: Graph;
    try {
      graph = buildGraph(await this.options.adapter.readNotes());
    } catch (error) {
      console.error('strategy graph: reading the vault failed', error);
      return;
    }
    if (generation !== this.generation || this.disposed) return;
    markLatest();
    for (const change of this.ids.update(graph.nodes)) {
      const earlier = this.idNotices.get(change.path);
      const from = earlier?.from ?? change.from;
      if (change.to === from) {
        this.idNotices.delete(change.path);
        continue;
      }
      const hadPosition = Boolean(this.store.map && Object.prototype.hasOwnProperty.call(this.store.map.positions, from));
      this.idNotices.set(change.path, { basename: change.basename, from, to: change.to, hadPosition });
      this.options.onIdChange?.(describeIdChange({ ...change, from }, hadPosition));
    }
    // Notes that are gone take their notices with them.
    const paths = new Set(graph.nodes.map((n) => n.path));
    for (const path of Array.from(this.idNotices.keys())) if (!paths.has(path)) this.idNotices.delete(path);
    const text = JSON.stringify(graph);
    if (this.graph && text === this.graphText) return; // id notices only change with the graph
    this.graph = graph;
    this.graphText = text;
    this.emit();
  }

  /** Nodes were dragged: positions by note id. False when the `.gsmap` can't be written. */
  move(updates: Readonly<Record<string, GsPosition>>): boolean {
    return this.store.move(updates);
  }

  /** A card, frame or link was changed on the graph. False when the `.gsmap` can't be written. */
  editMap(op: GsOp): boolean {
    return this.store.edit(op);
  }

  /** Forget every saved position (the graph's reset button). False when the `.gsmap` can't be written. */
  resetPositions(): boolean {
    return this.store.resetPositions();
  }

  /** Write pending moves now. */
  flush(): Promise<void> {
    return this.store.flush();
  }

  get hasUnsaved(): boolean {
    return this.store.hasUnsaved;
  }

  /** Stop rebuilding and rendering, and write what is pending. Safe to call twice. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.releaseWaiters();
    await this.store.flush();
  }

  private emit(): void {
    if (!this.disposed) this.options.onUpdate(this.state);
  }
}
