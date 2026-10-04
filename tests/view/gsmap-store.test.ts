import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GsMapStore } from '../../src/core/gsmap-store';
import { serializeGsMap, emptyGsMap, parseGsMap, type GsCard } from '../../src/core/gsmap';

/** A file on "disk" with a vault.process-like writer that can be held or made to fail. */
function disk(initial: string) {
  const file = { text: initial, writes: 0, fail: false as boolean, hold: null as null | Promise<void> };
  const write = async (edit: (text: string) => string) => {
    if (file.hold) await file.hold;
    if (file.fail) throw new Error('disk full');
    file.text = edit(file.text);
    file.writes++;
    return file.text;
  };
  return { file, write };
}

const start = serializeGsMap({ ...emptyGsMap(), positions: { 'B-1': { x: 0, y: 0 } } });
const positionsOn = (text: string) => {
  const read = parseGsMap(text);
  if (!read.ok) throw new Error(read.error);
  return read.map.positions;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('GsMapStore', () => {
  it('shows a move at once and writes it after a quiet period, once for a burst', async () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write, delayMs: 400 });
    store.load(file.text);
    store.move({ 'B-1': { x: 10.2, y: 20 } });
    store.move({ 'B-2': { x: 5, y: 5 } });
    expect(store.map!.positions).toEqual({ 'B-1': { x: 10, y: 20 }, 'B-2': { x: 5, y: 5 } });
    expect(file.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(399);
    expect(file.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(file.writes).toBe(1);
    expect(positionsOn(file.text)).toEqual({ 'B-1': { x: 10, y: 20 }, 'B-2': { x: 5, y: 5 } });
    expect(store.hasUnsaved).toBe(false);
  });

  it('flush() writes pending moves now (tab close) and waits for the write', async () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write });
    store.load(file.text);
    store.move({ 'B-1': { x: 1, y: 1 } });
    await store.flush();
    expect(positionsOn(file.text)['B-1']).toEqual({ x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(file.writes).toBe(1);
  });

  it('merges into what is on disk at write time, keeping an edit made meanwhile', async () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write });
    store.load(file.text);
    store.move({ 'B-1': { x: 1, y: 1 } });
    file.text = serializeGsMap({ ...emptyGsMap(), positions: { 'B-1': { x: 0, y: 0 }, 'A-1': { x: 7, y: 7 } } });
    await store.flush();
    expect(positionsOn(file.text)).toEqual({ 'B-1': { x: 1, y: 1 }, 'A-1': { x: 7, y: 7 } });
  });

  it('keeps a move that is still being written when the file reloads (no jump back)', async () => {
    const { file, write } = disk(start);
    let release!: () => void;
    file.hold = new Promise((r) => (release = r));
    const store = new GsMapStore({ write });
    store.load(file.text);
    store.move({ 'B-1': { x: 1, y: 1 } });
    const flushed = store.flush();
    store.load(start); // e.g. a Sync edit lands before our write
    expect(store.map!.positions['B-1']).toEqual({ x: 1, y: 1 });
    store.move({ 'B-2': { x: 2, y: 2 } });
    store.load(start);
    expect(store.map!.positions).toEqual({ 'B-1': { x: 1, y: 1 }, 'B-2': { x: 2, y: 2 } });
    release();
    await flushed;
    await store.flush();
    expect(positionsOn(file.text)).toEqual({ 'B-1': { x: 1, y: 1 }, 'B-2': { x: 2, y: 2 } });
    expect(store.map!.positions).toEqual({ 'B-1': { x: 1, y: 1 }, 'B-2': { x: 2, y: 2 } });
  });

  it('keeps a failed write pending, reports it, and retries on the next flush', async () => {
    const { file, write } = disk(start);
    const errors: unknown[] = [];
    const store = new GsMapStore({ write, onWriteError: (e) => errors.push(e) });
    store.load(file.text);
    store.move({ 'B-1': { x: 3, y: 3 } });
    file.fail = true;
    await store.flush();
    expect(errors).toHaveLength(1);
    expect(store.hasUnsaved).toBe(true);
    expect(store.map!.positions['B-1']).toEqual({ x: 3, y: 3 });
    file.fail = false;
    await store.flush();
    expect(positionsOn(file.text)['B-1']).toEqual({ x: 3, y: 3 });
    expect(store.hasUnsaved).toBe(false);
  });

  it('a failed write never overrides a newer move of the same node', async () => {
    const { file, write } = disk(start);
    let release!: () => void;
    file.hold = new Promise((r) => (release = r));
    file.fail = true;
    const store = new GsMapStore({ write, onWriteError: () => {} });
    store.load(file.text);
    store.move({ 'B-1': { x: 1, y: 1 } });
    const flushed = store.flush();
    store.move({ 'B-1': { x: 2, y: 2 } });
    release();
    await flushed;
    expect(store.map!.positions['B-1']).toEqual({ x: 2, y: 2 });
    file.fail = false;
    file.hold = null;
    await store.flush();
    expect(positionsOn(file.text)['B-1']).toEqual({ x: 2, y: 2 });
  });

  it('refuses moves, and never writes, while the file cannot be read', async () => {
    const { file, write } = disk('{"version": 9}');
    const store = new GsMapStore({ write });
    store.load(file.text);
    expect(store.error).toMatch(/newer plugin/);
    expect(store.map).toBeNull();
    expect(store.move({ 'B-1': { x: 1, y: 1 } })).toBe(false);
    await store.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(file.writes).toBe(0);
    expect(file.text).toBe('{"version": 9}');
  });

  it('a pending write into a file that broke meanwhile fails instead of overwriting it', async () => {
    const { file, write } = disk(start);
    const errors: unknown[] = [];
    const store = new GsMapStore({ write, onWriteError: (e) => errors.push(e) });
    store.load(file.text);
    store.move({ 'B-1': { x: 1, y: 1 } });
    file.text = '{ broken';
    await store.flush();
    expect(file.text).toBe('{ broken');
    expect(String(errors[0])).toMatch(/can't be read/);
  });

  it('reset shows no position at once, drops unwritten moves, and writes once', async () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write });
    store.load(file.text);
    store.move({ 'B-2': { x: 5, y: 5 } });
    expect(store.resetPositions()).toBe(true);
    expect(store.map!.positions).toEqual({});
    expect(store.hasUnsaved).toBe(true);
    await store.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(file.writes).toBe(1);
    expect(positionsOn(file.text)).toEqual({});
    expect(store.map!.positions).toEqual({});
    expect(store.hasUnsaved).toBe(false);
  });

  it('reset lands after a write already under way, and old positions never show again meanwhile', async () => {
    const { file, write } = disk(start);
    let release!: () => void;
    file.hold = new Promise((r) => (release = r));
    const store = new GsMapStore({ write });
    store.load(file.text);
    store.move({ 'B-2': { x: 5, y: 5 } });
    const flushed = store.flush();
    store.resetPositions();
    expect(store.map!.positions).toEqual({});
    store.load(file.text); // the file as it is before either write (e.g. a modify echo)
    expect(store.map!.positions).toEqual({});
    release();
    await flushed;
    expect(store.map!.positions).toEqual({}); // the move's write landed, the reset's not yet
    await store.flush();
    expect(file.writes).toBe(2);
    expect(positionsOn(file.text)).toEqual({});
    expect(store.map!.positions).toEqual({});
  });

  it('keeps a move made after the reset, written after it', async () => {
    const { file, write } = disk(start);
    let release!: () => void;
    file.hold = new Promise((r) => (release = r));
    const store = new GsMapStore({ write });
    store.load(file.text);
    store.resetPositions();
    store.move({ 'B-3': { x: 3, y: 3 } });
    expect(store.map!.positions).toEqual({ 'B-3': { x: 3, y: 3 } });
    release();
    await store.flush();
    expect(positionsOn(file.text)).toEqual({ 'B-3': { x: 3, y: 3 } });
  });

  it('a write from before a reset that fails does not bring its move back', async () => {
    const { file, write } = disk(start);
    let release!: () => void;
    file.hold = new Promise((r) => (release = r));
    file.fail = true;
    const errors: unknown[] = [];
    const store = new GsMapStore({ write, onWriteError: (e) => errors.push(e) });
    store.load(file.text);
    store.move({ 'B-2': { x: 5, y: 5 } });
    const flushed = store.flush();
    store.resetPositions();
    release();
    await flushed;
    await store.flush();
    expect(errors).toHaveLength(2); // the move and the reset
    expect(store.hasUnsaved).toBe(false);
    // The reset failed too, so the disk positions show again, without B-2's move.
    expect(store.map!.positions).toEqual({ 'B-1': { x: 0, y: 0 } });
    file.fail = false;
    file.hold = null;
    await store.flush();
    expect(positionsOn(file.text)).toEqual({ 'B-1': { x: 0, y: 0 } });
  });

  it('refuses a reset while the file cannot be read', async () => {
    const { file, write } = disk('{"version": 9}');
    const store = new GsMapStore({ write });
    store.load(file.text);
    expect(store.resetPositions()).toBe(false);
    await store.flush();
    expect(file.writes).toBe(0);
  });

  it('tells its owner about every change', async () => {
    const { file, write } = disk(start);
    let changes = 0;
    const store = new GsMapStore({ write, onChange: () => changes++ });
    store.load(file.text);
    store.move({ 'B-1': { x: 1, y: 1 } });
    await store.flush();
    expect(changes).toBe(3); // load, move, write confirmed
  });
});

describe('GsMapStore: card, frame and link edits (Phase 7)', () => {
  const card = (id: string, x = 0): GsCard => ({ id, kind: 'text', text: id, x, y: 0, width: 100, height: 50 }) as GsCard;
  const cardsOn = (text: string) => {
    const read = parseGsMap(text);
    if (!read.ok) throw new Error(read.error);
    return read.map.cards.map((c) => `${c.id}@${c.x}`);
  };

  it('shows an edit at once, and writes it with the moves in one write', async () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write, delayMs: 400 });
    store.load(file.text);
    expect(store.edit({ op: 'put-card', card: card('a') })).toBe(true);
    store.move({ 'B-1': { x: 9, y: 9 } });
    expect(store.map!.cards.map((c) => c.id)).toEqual(['a']);
    expect(store.hasUnsaved).toBe(true);
    expect(file.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(file.writes).toBe(1);
    expect(cardsOn(file.text)).toEqual(['a@0']);
    expect(positionsOn(file.text)).toEqual({ 'B-1': { x: 9, y: 9 } });
    expect(store.hasUnsaved).toBe(false);
  });

  it('keeps edits in order, and keeps the ones still on their way when the file reloads', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { file, write } = disk(start);
    const store = new GsMapStore({ write, delayMs: 100 });
    store.load(file.text);
    store.edit({ op: 'put-card', card: card('a') });
    file.hold = held;
    await vi.advanceTimersByTimeAsync(100); // handed to the writer, held
    store.edit({ op: 'put-card', card: card('a', 50) });
    store.edit({ op: 'put-card', card: card('b') });
    store.load(start); // the file is reloaded: neither the held edit nor the pending ones may vanish
    expect(store.map!.cards.map((c) => `${c.id}@${c.x}`)).toEqual(['a@50', 'b@0']);
    release();
    file.hold = null;
    await vi.advanceTimersByTimeAsync(100);
    await store.flush();
    expect(cardsOn(file.text)).toEqual(['a@50', 'b@0']);
  });

  it('keeps a failed write of edits pending, in front of newer ones, and retries it', async () => {
    const { file, write } = disk(start);
    const onWriteError = vi.fn();
    const store = new GsMapStore({ write, delayMs: 100, onWriteError });
    store.load(file.text);
    file.fail = true;
    store.edit({ op: 'put-card', card: card('a') });
    await vi.advanceTimersByTimeAsync(100);
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(store.map!.cards.map((c) => c.id)).toEqual(['a']); // still shown
    store.edit({ op: 'put-card', card: card('b') });
    file.fail = false;
    await store.flush();
    expect(cardsOn(file.text)).toEqual(['a@0', 'b@0']);
    expect(store.hasUnsaved).toBe(false);
  });

  it('builds what it shows once per change, not once per read', () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write, delayMs: 100 });
    store.load(file.text);
    store.edit({ op: 'put-card', card: card('a') });
    expect(store.map).toBe(store.map);
    const before = store.map;
    store.edit({ op: 'put-card', card: card('b') });
    expect(store.map).not.toBe(before);
    expect(store.map!.cards.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('refuses edits while the file cannot be read, and writes nothing', async () => {
    const { file, write } = disk('not json');
    const store = new GsMapStore({ write });
    store.load(file.text);
    expect(store.edit({ op: 'put-card', card: card('a') })).toBe(false);
    await store.flush();
    expect(file.writes).toBe(0);
  });

  it('a reset forgets positions, not cards', async () => {
    const { file, write } = disk(start);
    const store = new GsMapStore({ write, delayMs: 100 });
    store.load(file.text);
    store.edit({ op: 'put-card', card: card('a') });
    await store.flush();
    store.resetPositions();
    await store.flush();
    expect(positionsOn(file.text)).toEqual({});
    expect(cardsOn(file.text)).toEqual(['a@0']);
  });
});
