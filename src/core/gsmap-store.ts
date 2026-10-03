import { parseGsMap, writePositions, type GsMap, type GsPosition } from './gsmap';

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
 * moved but are not on disk yet. Moves show at once (`map` overlays them), are written after a
 * short quiet period, and a reload from disk (our own write echoing back, or an edit from Sync)
 * never drops a move that is still on its way.
 */
export class GsMapStore {
  private base: GsMap | null = null;
  private readError: string | null = null;
  /** Moved, not yet handed to the writer. */
  private pending = new Map<string, GsPosition>();
  /** Handed to the writer, not yet confirmed. */
  private inflight = new Map<string, GsPosition>();
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
    if (!this.inflight.size && !this.pending.size) return this.base;
    const positions = { ...this.base.positions };
    for (const [id, position] of this.inflight) positions[id] = position;
    for (const [id, position] of this.pending) positions[id] = position;
    return { ...this.base, positions };
  }

  get hasUnsaved(): boolean {
    return this.pending.size > 0 || this.inflight.size > 0;
  }

  /** Record moved node positions (by note id). Returns false, changing nothing, while the file can't be read. */
  move(updates: Readonly<Record<string, GsPosition>>): boolean {
    if (!this.base) return false;
    const entries = Object.entries(updates);
    if (!entries.length) return true;
    for (const [id, { x, y }] of entries) this.pending.set(id, { x: Math.round(x), y: Math.round(y) });
    this.options.onChange?.();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
    return true;
  }

  /** Write every pending move now. Resolves when everything moved so far has been written or has failed. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size) {
      const batch = new Map(this.pending);
      this.pending.clear();
      for (const [id, position] of batch) this.inflight.set(id, position);
      const updates = Object.fromEntries(batch);
      this.queue = this.queue.then(async () => {
        try {
          const written = await this.options.write((text) => writePositions(text, updates));
          // What we just wrote is the disk state now, whether or not its modify event has arrived yet.
          if (typeof written === 'string') {
            const read = parseGsMap(written);
            if (read.ok) this.base = read.map;
          }
        } catch (error) {
          // Back to pending, unless a newer move of the same node is already waiting.
          for (const [id, position] of batch) if (!this.pending.has(id)) this.pending.set(id, position);
          this.options.onWriteError?.(error);
        } finally {
          for (const [id, position] of batch) if (this.inflight.get(id) === position) this.inflight.delete(id);
          this.options.onChange?.();
        }
      });
    }
    return this.queue;
  }
}
