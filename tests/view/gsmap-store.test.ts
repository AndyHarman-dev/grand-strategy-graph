import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GsMapStore } from '../../src/core/gsmap-store';
import { serializeGsMap, emptyGsMap, parseGsMap } from '../../src/core/gsmap';

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
