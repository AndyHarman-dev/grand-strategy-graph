import { describe, expect, it } from 'vitest';
import { parseGsMap } from '../../src/core/gsmap';
import { elkPositions, flowOf, layoutGraph, layoutKey, NODE_SIZES, pinnedPositions, placeNodes } from '../../src/core/layout';
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

  it('puts assumptions and prerequisites left of what leans on them', async () => {
    const graph = await graphOf(migratedTestVault());
    const x = xOf(await layoutGraph(graph, {}));
    expect(x('A-1')).toBeLessThan(x('B-1'));
    expect(x('B-3')).toBeLessThan(x('B-4')); // B-4 requires B-3
    expect(x('A-6')).toBeLessThan(x('FP-1'));
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
