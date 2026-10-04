import { applyOps, clearPositions, parseGsMap, writeOps, writePositions, type GsMap, type GsOp, type GsPosition } from './gsmap';

/**
 * Applies an edit to the file as it is on disk at write time (`vault.process` in Obsidian),
 * so a change made elsewhere between our read and our write is kept, not overwritten.
 * Resolves with the text written, as `vault.process` does.
 */
export type GsMapWriter = (edit: (text: string) => string) => Promise<string | void>;

export interface GsMapStoreOptions {
  write: GsMapWriter;
  /** Called whenever `map` or `error` changes. */
  onChange?: () => void;
  /** Called when a write fails; the positions stay pending and are retried by the next flush. */
  onWriteError?: (error: unknown) => void;
  /** Quiet time after the last move before writing, so a burst of drags is one write. */
  delayMs?: number;
}

/**
 * The view's copy of `Strategy.gsmap`: what was last read from disk, plus positions that were
 * moved and card, frame and link edits (`GsOp`) that are not on disk yet. They show at once (`map`
 * overlays them), are written after a short quiet period in one write, and a reload from disk (our
 * own write echoing back, or an edit from Sync) never drops one that is still on its way.
 */
export class GsMapStore {
  private base: GsMap | null = null;
  private readError: string | null = null;
  /** Moved, not yet handed to the writer. */
  private pending = new Map<string, GsPosition>();
  /** Handed to the writer, not yet confirmed. */
  private inflight = new Map<string, GsPosition>();
  /** Card, frame and link edits: not yet handed to the writer, and handed but not confirmed. */
  private pendingOps: GsOp[] = [];
  private inflightOps: GsOp[] = [];
  /** Resets queued or being written. While there is one, positions from before it are not shown. */
  private resets = 0;
  /** Counts resets: a write from before the latest one that fails must not bring its moves back. */
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly delayMs: number;

  constructor(private readonly options: GsMapStoreOptions) {
    this.delayMs = options.delayMs ?? 400;
  }

  /** Take the file's current text (on open, and after every modify event). */
  load(text: string): void {
    const read = parseGsMap(text);
    this.base = read.ok ? read.map : null;
    this.readError = read.ok ? null : read.error;
    this.options.onChange?.();
  }

  /** Why the file can't be used, or null. While set, `map` is null and moves are refused. */
  get error(): string | null {
    return this.readError;
  }

  /** The map to display: disk state with unsaved moves on top. Null before a load or on a read error. */
  get map(): GsMap | null {
    if (!this.base) return null;
    if (!this.resets && !this.inflight.size && !this.pending.size && !this.inflightOps.length && !this.pendingOps.length) return this.base;
    // After a reset, the disk still has the old positions until its write lands: show none of them.
    const positions = this.resets ? {} : { ...this.base.positions };
    for (const [id, position] of this.inflight) positions[id] = position;
    for (const [id, position] of this.pending) positions[id] = position;
    return applyOps({ ...this.base, positions }, [...this.inflightOps, ...this.pendingOps]);
  }

  get hasUnsaved(): boolean {
    return this.pending.size > 0 || this.inflight.size > 0 || this.resets > 0 || this.pendingOps.length > 0 || this.inflightOps.length > 0;
  }

  /** Record moved node positions (by note id). Returns false, changing nothing, while the file can't be read. */
  move(updates: Readonly<Record<string, GsPosition>>): boolean {
    if (!this.base) return false;
    const entries = Object.entries(updates);
    if (!entries.length) return true;
    for (const [id, { x, y }] of entries) this.pending.set(id, { x: Math.round(x), y: Math.round(y) });
    this.options.onChange?.();
    this.scheduleFlush();
    return true;
  }

  /** Record a card, frame or link edit. Returns false, changing nothing, while the file can't be read. */
  edit(op: GsOp): boolean {
    if (!this.base) return false;
    this.pendingOps.push(op);
    this.options.onChange?.();
    this.scheduleFlush();
    return true;
  }

  private scheduleFlush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /**
   * Forget every saved position, so every node is laid out automatically again. Shows at once and
   * is written now, after any write already under way; moves not written yet are dropped. Moves
   * made after this are kept. Returns false, changing nothing, while the file can't be read.
   */
  resetPositions(): boolean {
    if (!this.base) return false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.inflight.clear(); // still written, but the reset is queued after them and wipes them
    this.resets++;
    this.epoch++;
    this.options.onChange?.();
    this.queue = this.queue.then(async () => {
      try {
        const written = await this.options.write(clearPositions);
        const read = typeof written === 'string' ? parseGsMap(written) : null;
        if (read?.ok) this.base = read.map;
        else if (this.base) this.base = { ...this.base, positions: {} };
      } catch (error) {
        // The old positions are still on disk, so they show again.
        this.options.onWriteError?.(error);
      } finally {
        this.resets--;
        this.options.onChange?.();
      }
    });
    return true;
  }

  /** Write every pending move now. Resolves when everything moved so far has been written or has failed. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size || this.pendingOps.length) {
      const batch = new Map(this.pending);
      const ops = this.pendingOps;
      this.pending.clear();
      this.pendingOps = [];
      for (const [id, position] of batch) this.inflight.set(id, position);
      this.inflightOps.push(...ops);
      const updates = Object.fromEntries(batch);
      const epoch = this.epoch;
      this.queue = this.queue.then(async () => {
        try {
          const written = await this.options.write((text) => {
            const moved = batch.size ? writePositions(text, updates) : text;
            return ops.length ? writeOps(moved, ops) : moved;
          });
          // What we just wrote is the disk state now, whether or not its modify event has arrived yet.
          if (typeof written === 'string') {
            const read = parseGsMap(written);
            if (read.ok) this.base = read.map;
          }
        } catch (error) {
          // Back to pending, unless a newer move of the same node is already waiting or the positions were reset since.
          if (epoch === this.epoch) for (const [id, position] of batch) if (!this.pending.has(id)) this.pending.set(id, position);
          // Edits go back in front of the newer ones, in order: a later edit may rest on an earlier one.
          this.pendingOps = [...ops, ...this.pendingOps];
          this.options.onWriteError?.(error);
        } finally {
          for (const [id, position] of batch) if (this.inflight.get(id) === position) this.inflight.delete(id);
          this.inflightOps = this.inflightOps.filter((op) => !ops.includes(op));
          this.options.onChange?.();
        }
      });
    }
    return this.queue;
  }
}
