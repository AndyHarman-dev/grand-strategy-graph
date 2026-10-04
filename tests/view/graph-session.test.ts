import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphSession, type GraphState } from '../../src/core/graph-session';
import { MemoryAdapter } from '../../src/core/memory-adapter';
import type { NoteRecord } from '../../src/core/schema';
import { md } from '../support/v2';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const note = (id: string) => md({ id, type: 'bet', status: 'active' });

function session(adapter: { readNotes(): Promise<NoteRecord[]> }) {
  const states: GraphState[] = [];
  const idChanges: string[] = [];
  const s = new GraphSession({
    adapter,
    write: async (edit) => edit(''),
    onUpdate: (state) => states.push(state),
    onIdChange: (message) => idChanges.push(message),
  });
  return { s, states, idChanges, keys: () => states[states.length - 1].graph!.nodes.map((n) => n.key) };
}

describe('GraphSession', () => {
  it('drops a rebuild that finished after a newer one (newest read wins)', async () => {
    const reads: { resolve: (notes: NoteRecord[]) => void }[] = [];
    const { s, keys, states } = session({ readNotes: () => new Promise((resolve) => reads.push({ resolve })) });
    const older = s.rebuild();
    const newer = s.rebuild();
    reads[1].resolve(await new MemoryAdapter({ 'Strategy/B-2.md': note('B-2') }).readNotes());
    await newer;
    reads[0].resolve(await new MemoryAdapter({ 'Strategy/B-1.md': note('B-1') }).readNotes());
    await older;
    expect(keys()).toEqual(['B-2']);
    expect(states).toHaveLength(1);
  });

  it('renders nothing after dispose, even for a read already under way', async () => {
    let resolve!: (notes: NoteRecord[]) => void;
    const { s, states } = session({ readNotes: () => new Promise((r) => (resolve = r)) });
    const pending = s.rebuild();
    await s.dispose();
    resolve(await new MemoryAdapter({ 'Strategy/B-1.md': note('B-1') }).readNotes());
    await pending;
    s.requestRebuild();
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([]);
  });

  it('follows a renamed note, so a rename that also changes the id is still reported', async () => {
    const files: Record<string, string> = { 'Strategy/B-1.md': note('B-1') };
    const { s, idChanges } = session(new MemoryAdapter(files) as never);
    await s.rebuild();
    // MemoryAdapter reads `files` lazily, so editing it is a vault change.
    const adapterFiles = files;
    delete adapterFiles['Strategy/B-1.md'];
    adapterFiles['Strategy/B-7.md'] = note('B-7');
    s.rename('Strategy/B-1.md', 'Strategy/B-7.md');
    await vi.advanceTimersByTimeAsync(1000);
    expect(idChanges).toEqual(['B-7 changed id from "B-1" to "B-7".']);
  });

  it('a failed vault read keeps the last graph', async () => {
    let fail = false;
    const inner = new MemoryAdapter({ 'Strategy/B-1.md': note('B-1') });
    const { s, states } = session({ readNotes: () => (fail ? Promise.reject(new Error('boom')) : inner.readNotes()) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await s.rebuild();
    fail = true;
    await s.rebuild();
    expect(states).toHaveLength(1);
    expect(s.state.graph!.nodes).toHaveLength(1);
  });
});

describe('GraphSession.settle', () => {
  it('resolves once the rebuild it asked for has read the vault, and not before', async () => {
    const reads: (() => void)[] = [];
    const { s } = session({ readNotes: async () => (await new Promise<void>((resolve) => reads.push(resolve)), []) });
    let settled = false;
    void s.settle().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(250); // the quiet period: the read starts
    expect(reads).toHaveLength(1);
    expect(settled).toBe(false);
    reads[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it('leaves its caller to the newer rebuild when one overtakes it, and gives up after its timeout', async () => {
    const reads: (() => void)[] = [];
    const { s } = session({ readNotes: async () => (await new Promise<void>((resolve) => reads.push(resolve)), []) });
    let settled = false;
    void s.settle(5000).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(250); // read 1 starts
    void s.rebuild(); // a newer one starts before read 1 is back
    reads[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // the overtaken one doesn't release it
    reads[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    let timedOut = false;
    void s.settle(1000).then(() => (timedOut = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(timedOut).toBe(true); // the read never answered: it is not waited for forever
  });

  it('releases a waiter when the session is disposed', async () => {
    const { s } = session({ readNotes: () => new Promise(() => {}) });
    let settled = false;
    void s.settle(60_000).then(() => (settled = true));
    await s.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });
});

describe('GraphSession: the free part of the map (Phase 7)', () => {
  const gsmap = JSON.stringify({
    version: 1,
    positions: {},
    cards: [{ id: 'c', kind: 'text', text: 'idea', x: 0, y: 0, width: 100, height: 50 }],
    frames: [],
    links: [
      { id: 'ok', from: { card: 'c' }, to: { note: 'B-1' } },
      { id: 'gone', label: 'old', from: { card: 'c' }, to: { note: 'B-404' } },
      { id: 'both', from: { note: 'B-1' }, to: { note: 'B-405' } },
    ],
  });

  it('warns about a link that ends on a note that is not on the graph, once per link, and only then', async () => {
    const { s, states } = session(new MemoryAdapter({ 'Strategy/B-1.md': note('B-1') }));
    s.loadMap(gsmap);
    await s.rebuild();
    const warnings = states[states.length - 1].notices.filter((n) => n.message.startsWith('A link on the graph'));
    expect(warnings.map((n) => n.message)).toEqual([
      'A link on the graph ("old") ends on "B-404", which is not a note on the graph; it is not drawn.',
      'A link on the graph ends on "B-405", which is not a note on the graph; it is not drawn.',
    ]);
    expect(warnings.every((n) => n.severity === 'warning')).toBe(true);
  });

  it('has no such warning when every end is there', async () => {
    const { s, states } = session(new MemoryAdapter({ 'Strategy/B-1.md': note('B-1'), 'Strategy/B-404.md': note('B-404'), 'Strategy/B-405.md': note('B-405') }));
    s.loadMap(gsmap);
    await s.rebuild();
    expect(states[states.length - 1].notices).toEqual([]);
  });

  it('shows a card edit at once and writes it, and refuses while the map cannot be read', async () => {
    const { s, states } = session(new MemoryAdapter({ 'Strategy/B-1.md': note('B-1') }));
    s.loadMap(gsmap);
    await s.rebuild();
    expect(s.editMap({ op: 'delete-card', id: 'c' })).toBe(true);
    expect(states[states.length - 1].map!.cards).toEqual([]);
    expect(s.hasUnsaved).toBe(true);
    s.loadMap('not json');
    expect(s.editMap({ op: 'delete-card', id: 'c' })).toBe(false);
  });
});
