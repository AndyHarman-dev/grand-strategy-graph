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
