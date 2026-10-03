import { describe, expect, it } from 'vitest';
import { parseGsMap } from '../../src/core/gsmap';
import { elkPositions, flowOf, layoutGraph, layoutKey, NODE_SIZES, pinnedPositions, placeNodes, structureOf } from '../../src/core/layout';
import type { Graph } from '../../src/core/schema';
import { plannedTestVault } from '../../tools/test-vault';
import { graphOf, md, migratedTestVault } from '../support/v2';

const rects = (graph: Graph, positions: Record<string, { x: number; y: number }>) =>
  graph.nodes.map((n) => ({ key: n.key, ...positions[n.key], ...NODE_SIZES[n.type] }));

function overlapping(graph: Graph, positions: Record<string, { x: number; y: number }>): string[] {
  const all = rects(graph, positions);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) out.push(`${a.key}/${b.key}`);
    }
  return out;
}

function expectAbove(graph: Graph, positions: Record<string, { x: number; y: number }>, assumption: string, host: string) {
  const [a, h] = [rects(graph, positions).find((r) => r.key === assumption)!, rects(graph, positions).find((r) => r.key === host)!];
  expect(a.x + a.width / 2, `${assumption} centered on ${host}`).toBeCloseTo(h.x + h.width / 2);
  expect(a.y + a.height, `${assumption} above ${host}`).toBeLessThan(h.y);
}

const xOf = (positions: Record<string, { x: number }>) => (key: string) => positions[key].x;

describe('flowOf', () => {
  it('draws serves and next along the field, requires and assumptions against it', () => {
    expect(flowOf({ kind: 'serves', from: 'B-1', to: 'FP-1' })).toEqual({ source: 'B-1', target: 'FP-1' });
    expect(flowOf({ kind: 'next', from: 'B-1', to: 'B-2' })).toEqual({ source: 'B-1', target: 'B-2' });
    expect(flowOf({ kind: 'requires', from: 'B-4', to: 'B-3' })).toEqual({ source: 'B-3', target: 'B-4' });
    expect(flowOf({ kind: 'assumption', from: 'B-1', to: 'A-1' })).toEqual({ source: 'A-1', target: 'B-1' });
  });
});

describe('ELK layout with nothing saved', () => {
  it('goes left to right: current position, bets along serves chains, milestones, fixed points', async () => {
    const graph = await graphOf({
      'Strategy/CP.md': md({ id: 'CP', type: 'current-position' }),
      'Strategy/FP-1.md': md({ id: 'FP-1', type: 'fixed-point' }),
      'Strategy/FP-2.md': md({ id: 'FP-2', type: 'fixed-point' }),
      'Strategy/M-1.md': md({ id: 'M-1', type: 'milestone', status: 'open', serves: ['[[FP-1]]'] }),
      'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', status: 'active', serves: ['[[B-2]]'] }),
      'Strategy/B-2.md': md({ id: 'B-2', type: 'bet', status: 'active', serves: ['[[M-1]]'] }),
      'Strategy/B-3.md': md({ id: 'B-3', type: 'bet', status: 'active', serves: ['[[FP-1]]'], requires: ['[[M-1]]'] }),
      'Strategy/B-4.md': md({ id: 'B-4', type: 'bet', status: 'active' }),
    });
    const positions = await layoutGraph(graph, {});
    const x = xOf(positions);
    expect(x('CP')).toBeLessThan(x('B-1'));
    expect(x('CP')).toBeLessThan(x('B-4'));
    expect(x('B-1')).toBeLessThan(x('B-2'));
    expect(x('B-2')).toBeLessThan(x('M-1'));
    expect(x('M-1')).toBeLessThan(x('B-3'));
    expect(x('B-3')).toBeLessThan(x('FP-1'));
    // Fixed points share the last column, linked or not.
    expect(x('FP-2')).toBe(x('FP-1'));
    expect(overlapping(graph, positions)).toEqual([]);
  });

  it('keeps assumptions off the time axis: prerequisites go left, assumptions sit above their host (D19)', async () => {
    const graph = await graphOf(migratedTestVault());
    const positions = await layoutGraph(graph, {});
    const x = xOf(positions);
    expect(x('B-3')).toBeLessThan(x('B-4')); // B-4 requires B-3
    for (const [assumption, host] of [['A-1', 'B-1'], ['A-5', 'B-5'], ['A-6', 'FP-1']]) expectAbove(graph, positions, assumption, host);
    expect(overlapping(graph, positions)).toEqual([]);
  });

  it('is deterministic', async () => {
    const graph = await graphOf(migratedTestVault());
    expect(await elkPositions(graph)).toEqual(await elkPositions(graph));
  });

  it('handles an empty graph', async () => {
    expect(await layoutGraph({ nodes: [], edges: [], issues: [] }, {})).toEqual({});
  });
});

describe('saved positions', () => {
  it('the planned test vault has every node saved, so ELK never runs and every position is kept', async () => {
    const files = plannedTestVault();
    const graph = await graphOf(files);
    const read = parseGsMap(files['Strategy/Strategy.gsmap']);
    if (!read.ok) throw new Error(read.error);
    const positions = await layoutGraph(graph, read.map.positions);
    expect(Object.keys(positions).sort()).toEqual(graph.nodes.map((n) => n.key).sort());
    for (const node of graph.nodes) expect(positions[node.key]).toEqual(read.map.positions[node.key]);
  });

  it('keeps pinned nodes exactly and places a new bet left of the bet it serves, without overlap', async () => {
    const files = migratedTestVault();
    const graph = await graphOf({
      ...files,
      'Strategy/Bets/B-9 New.md': md({ id: 'B-9', type: 'bet', status: 'active', serves: ['[[B-4 Save 20000 for kiln and lease]]'] }),
    });
    const all = await elkPositions(graph);
    const saved = Object.fromEntries(Object.entries(all).filter(([k]) => k !== 'B-9').map(([k, p]) => [k, { x: p.x + 5000, y: p.y - 300 }]));
    const positions = await layoutGraph(graph, saved);
    for (const [key, p] of Object.entries(saved)) expect(positions[key]).toEqual(p);
    expect(positions['B-9'].x).toBeLessThan(positions['B-4'].x);
    expect(positions['B-9'].x).toBeGreaterThan(4000);
    expect(overlapping(graph, positions)).toEqual([]);
  });

  it('places a group with no saved neighbour as a block below the saved nodes', async () => {
    const graph = await graphOf({
      'Strategy/FP-1.md': md({ id: 'FP-1', type: 'fixed-point' }),
      'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', status: 'active', serves: ['[[FP-1]]'] }),
      'Strategy/B-2.md': md({ id: 'B-2', type: 'bet', status: 'active', serves: ['[[B-3]]'] }),
      'Strategy/B-3.md': md({ id: 'B-3', type: 'bet', status: 'active' }),
    });
    const positions = await layoutGraph(graph, { 'FP-1': { x: 1000, y: 0 }, 'B-1': { x: 0, y: 0 } });
    expect(positions['B-2'].y).toBeGreaterThan(NODE_SIZES.bet.height);
    expect(positions['B-3'].y).toBe(positions['B-2'].y);
    expect(positions['B-2'].x).toBe(0);
    expect(positions['B-2'].x).toBeLessThan(positions['B-3'].x);
    expect(overlapping(graph, positions)).toEqual([]);
  });

  it('pushes a placed node clear of a saved node in its way', async () => {
    const graph = await graphOf({
      'Strategy/FP-1.md': md({ id: 'FP-1', type: 'fixed-point' }),
      'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', status: 'active', serves: ['[[FP-1]]'] }),
      'Strategy/B-2.md': md({ id: 'B-2', type: 'bet', status: 'active', serves: ['[[FP-1]]'] }),
    });
    const layered = await elkPositions(graph);
    // B-1 saved exactly where ELK would put B-2 relative to FP-1.
    const fp = { x: 0, y: 0 };
    const b2 = { x: layered['B-2'].x - layered['FP-1'].x, y: layered['B-2'].y - layered['FP-1'].y };
    const positions = placeNodes(graph, layered, { 'FP-1': fp, 'B-1': b2 });
    expect(positions['B-1']).toEqual(b2);
    expect(overlapping(graph, positions)).toEqual([]);
  });

  it('ignores a saved position for a node without a usable id, and positions of notes not in the graph', async () => {
    const graph = await graphOf({
      'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', status: 'active' }),
      'Strategy/No id.md': md({ type: 'bet', status: 'active' }),
      'Strategy/Dup a.md': md({ id: 'D', type: 'bet', status: 'active' }),
      'Strategy/Dup b.md': md({ id: 'D', type: 'bet', status: 'active' }),
    });
    const pinned = pinnedPositions(graph, { 'B-1': { x: 1, y: 1 }, D: { x: 2, y: 2 }, 'Strategy/No id.md': { x: 3, y: 3 }, Gone: { x: 4, y: 4 } });
    expect(pinned).toEqual({ 'B-1': { x: 1, y: 1 } });
  });
});

describe('layoutKey', () => {
  it('changes with nodes and visible edges only', async () => {
    const base = await graphOf(migratedTestVault());
    const same = await graphOf(migratedTestVault());
    const b7 = base.nodes.find((n) => n.key === 'B-7')!.path;
    expect(layoutKey(same)).toBe(layoutKey(base));
    const moreEdges = await graphOf({
      ...migratedTestVault(),
      [b7]: md({ id: 'B-7', type: 'bet', status: 'active', serves: ['[[FP-1 Live in Portugal]]'] }),
    });
    expect(layoutKey(moreEdges)).not.toBe(layoutKey(base));
    const hiddenOnly = await graphOf({
      ...migratedTestVault(),
      [b7]: md({ id: 'B-7', type: 'bet', status: 'active', 'ultimately-serves': ['[[FP-1 Live in Portugal]]'] }),
    });
    expect(layoutKey(hiddenOnly)).toBe(layoutKey(base));
  });
});

describe('assumptions and sequels (D19)', () => {
  const fp = md({ id: 'FP-1', type: 'fixed-point' });
  const bet = (id: string, fm: Record<string, unknown> = {}) => md({ id, type: 'bet', status: 'active', serves: ['[[FP-1]]'], ...fm });
  const assumption = (id: string) => md({ id, type: 'assumption', status: 'unverified' });

  it('hosts a shared assumption on its earliest holder, by key on a tie', async () => {
    const graph = await graphOf({
      'Strategy/FP-1.md': fp,
      'Strategy/B-1.md': bet('B-1', { serves: ['[[B-2]]'], assumptions: ['[[A-1]]'] }),
      'Strategy/B-2.md': bet('B-2', { assumptions: ['[[A-1]]'] }), // one column after B-1
      'Strategy/B-3.md': bet('B-3', { assumptions: ['[[A-2]]'] }),
      'Strategy/B-4.md': bet('B-4', { assumptions: ['[[A-2]]'] }), // same column as B-3
      'Strategy/A-1.md': assumption('A-1'),
      'Strategy/A-2.md': assumption('A-2'),
      'Strategy/A-3.md': assumption('A-3'),
    });
    const s = structureOf(graph);
    expect(Object.fromEntries(s.hostOf)).toEqual({ 'A-1': 'B-1', 'A-2': 'B-3' });
    // Held by nothing: an assumption of its own on the time axis.
    expect(s.time).toContain('A-3');
  });

  it('stacks several assumptions upward above their host', async () => {
    const graph = await graphOf({
      'Strategy/FP-1.md': fp,
      'Strategy/B-1.md': bet('B-1', { assumptions: ['[[A-1]]', '[[A-2]]', '[[A-3]]'] }),
      'Strategy/A-1.md': assumption('A-1'),
      'Strategy/A-2.md': assumption('A-2'),
      'Strategy/A-3.md': assumption('A-3'),
    });
    const positions = await layoutGraph(graph, {});
    for (const a of ['A-1', 'A-2', 'A-3']) expectAbove(graph, positions, a, 'B-1');
    expect(positions['A-1'].y).toBeGreaterThan(positions['A-2'].y);
    expect(positions['A-2'].y).toBeGreaterThan(positions['A-3'].y);
    expect(overlapping(graph, positions)).toEqual([]);
  });

  it('puts a sequel directly below its bet; the sequel\'s assumptions go below it, or aside when a further sequel is there', async () => {
    const graph = await graphOf({
      'Strategy/FP-1.md': fp,
      'Strategy/B-1.md': bet('B-1', { next: '[[B-2]]', assumptions: ['[[A-1]]'] }),
      'Strategy/B-2.md': bet('B-2', { status: 'dormant', next: '[[B-3]]', assumptions: ['[[A-2]]'] }),
      'Strategy/B-3.md': bet('B-3', { status: 'dormant', assumptions: ['[[A-3]]'] }),
      'Strategy/A-1.md': assumption('A-1'),
      'Strategy/A-2.md': assumption('A-2'),
      'Strategy/A-3.md': assumption('A-3'),
    });
    const p = await layoutGraph(graph, {});
    const h = NODE_SIZES.bet.height;
    expect(p['B-2'].x).toBe(p['B-1'].x);
    expect(p['B-3'].x).toBe(p['B-1'].x);
    expect(p['B-2'].y).toBeGreaterThan(p['B-1'].y + h);
    expect(p['B-3'].y).toBeGreaterThan(p['B-2'].y + h);
    expectAbove(graph, p, 'A-1', 'B-1');
    // B-2: above is B-1, below is B-3, so A-2 moves aside, to the right of the column.
    expect(p['A-2'].x).toBeGreaterThan(p['B-2'].x + NODE_SIZES.bet.width);
    // B-3: above is B-2, nothing below: A-3 goes below.
    expect(p['A-3'].y).toBeGreaterThan(p['B-3'].y + h);
    expect(p['A-3'].x + NODE_SIZES.assumption.width / 2).toBeCloseTo(p['B-3'].x + NODE_SIZES.bet.width / 2);
    expect(overlapping(graph, p)).toEqual([]);
  });

  it('a sequel loop does not hang, and a bet holds at most one sequel below it', async () => {
    const graph = await graphOf({
      'Strategy/FP-1.md': fp,
      'Strategy/B-1.md': bet('B-1', { next: '[[B-2]]' }),
      'Strategy/B-2.md': bet('B-2', { next: '[[B-1]]' }),
      'Strategy/B-3.md': bet('B-3', { next: '[[B-4]]' }),
      'Strategy/B-4.md': bet('B-4'),
      'Strategy/B-5.md': bet('B-5', { next: '[[B-4]]' }),
    });
    const s = structureOf(graph);
    expect(s.predecessorOf.get('B-4')).toBe('B-3');
    expect([s.predecessorOf.get('B-1'), s.predecessorOf.get('B-2')].filter(Boolean)).toHaveLength(1);
    expect(overlapping(graph, await layoutGraph(graph, {}))).toEqual([]);
  });

  describe('next to saved nodes', () => {
    const files = {
      'Strategy/FP-1.md': fp,
      'Strategy/B-1.md': bet('B-1', { assumptions: ['[[A-1]]'] }),
      'Strategy/B-2.md': bet('B-2'),
      'Strategy/B-3.md': bet('B-3'),
      'Strategy/A-1.md': assumption('A-1'),
    };
    const saved = { 'FP-1': { x: 1000, y: 0 }, 'B-1': { x: 0, y: 500 } };

    it('an unsaved assumption goes above its saved host', async () => {
      const graph = await graphOf(files);
      const p = await layoutGraph(graph, { ...saved, 'B-2': { x: 2000, y: 2000 }, 'B-3': { x: 2000, y: 3000 } });
      expectAbove(graph, p, 'A-1', 'B-1');
    });

    it('below when a saved node takes the room above, aside when below is taken too', async () => {
      const graph = await graphOf(files);
      const above = { 'B-2': { x: 0, y: 400 }, 'B-3': { x: 2000, y: 3000 } };
      let p = await layoutGraph(graph, { ...saved, ...above });
      expect(p['A-1'].y).toBeGreaterThan(500 + NODE_SIZES.bet.height);
      expect(p['A-1'].x).toBeLessThan(NODE_SIZES.bet.width);
      p = await layoutGraph(graph, { ...saved, ...above, 'B-3': { x: 0, y: 600 } });
      expect(p['A-1'].x).toBeGreaterThan(NODE_SIZES.bet.width);
      expect(overlapping(graph, p)).toEqual([]);
    });

    it('an unsaved sequel goes directly below its saved bet', async () => {
      const graph = await graphOf({ ...files, 'Strategy/B-1.md': bet('B-1', { next: '[[B-2]]' }) });
      const p = await layoutGraph(graph, { ...saved, 'B-3': { x: 2000, y: 3000 } });
      expect(p['B-2']).toEqual({ x: 0, y: 500 + NODE_SIZES.bet.height + 40 });
    });

    it('a saved assumption stays where it was saved', async () => {
      const graph = await graphOf(files);
      const p = await layoutGraph(graph, { ...saved, 'A-1': { x: -300, y: 500 }, 'B-2': { x: 2000, y: 2000 }, 'B-3': { x: 2000, y: 3000 } });
      expect(p['A-1']).toEqual({ x: -300, y: 500 });
    });
  });
});
