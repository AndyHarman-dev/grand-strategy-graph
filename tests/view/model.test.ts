import { describe, expect, it } from 'vitest';
import { movedPositions, titleOf, toFlowEdges, toFlowNodes } from '../../src/ui/model';
import { graphOf, md } from '../support/v2';

const files = {
  'Strategy/CP.md': md({ id: 'CP', type: 'current-position' }),
  'Strategy/FP-1 Live.md': md({ id: 'FP-1', type: 'fixed-point' }),
  'Strategy/A-1 Rent.md': md({ id: 'A-1', type: 'assumption', status: 'unverified' }),
  'Strategy/B-10  byTalent.md': md({
    id: 'B-10', type: 'bet', status: 'active', serves: ['[[FP-1 Live]]'], 'ultimately-serves': ['[[FP-1 Live]]'],
    assumptions: ['[[A-1 Rent]]'], requires: ['[[B-2]]'], next: '[[B-2]]',
  }),
  'Strategy/B-2.md': md({ id: 'B-2', type: 'bet', status: 'dormant' }),
  'Strategy/No id.md': md({ type: 'bet', status: 'active' }),
};

describe('toFlowNodes', () => {
  it('locks fixed points and notes without a usable id, and hides nodes with no position yet', async () => {
    const graph = await graphOf(files);
    const nodes = toFlowNodes(graph, { 'FP-1': { x: 1, y: 2 }, 'B-10': { x: 3, y: 4 }, 'Strategy/No id.md': { x: 5, y: 6 } });
    const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(by['FP-1']).toMatchObject({ draggable: false, hidden: false, position: { x: 1, y: 2 } });
    expect(by['B-10']).toMatchObject({ draggable: true, hidden: false, position: { x: 3, y: 4 }, width: 240 });
    expect(by['Strategy/No id.md']).toMatchObject({ draggable: false, hidden: false, data: { pinnable: false } });
    expect(by['CP']).toMatchObject({ hidden: true });
    expect(nodes.every((n) => n.connectable === false && n.deletable === false)).toBe(true);
  });
});

describe('toFlowEdges', () => {
  it('orients edges left to right, labels next, hides ultimately-serves, drops the arrow on assumptions', async () => {
    const edges = toFlowEdges(await graphOf(files));
    const by = Object.fromEntries(edges.map((e) => [e.id, e]));
    expect(by['serves:B-10>FP-1']).toMatchObject({ source: 'B-10', target: 'FP-1', hidden: false, markerEnd: { type: 'arrowclosed' } });
    expect(by['requires:B-10>B-2']).toMatchObject({ source: 'B-2', target: 'B-10', className: 'gs-edge gs-edge-requires' });
    expect(by['next:B-10>B-2']).toMatchObject({ source: 'B-10', target: 'B-2', label: 'on kill' });
    expect(by['assumption:B-10>A-1']).toMatchObject({ source: 'A-1', target: 'B-10' });
    expect(by['assumption:B-10>A-1'].markerEnd).toBeUndefined();
    expect(by['ultimately-serves:B-10>FP-1'].hidden).toBe(true);
  });
});

describe('titleOf', () => {
  it('strips the id prefix, double space included', () => {
    expect(titleOf({ id: 'B-10', basename: 'B-10  byTalent backend engineer' })).toBe('byTalent backend engineer');
    expect(titleOf({ id: 'CP', basename: 'Current Position' })).toBe('Current Position');
    expect(titleOf({ id: 'B-2', basename: 'B-2' })).toBe('B-2');
    expect(titleOf({ id: null, basename: 'No id' })).toBe('No id');
  });
});

describe('movedPositions', () => {
  it('saves by note id, and never a fixed point or a node without a usable id', async () => {
    const graph = await graphOf(files);
    const nodes = toFlowNodes(graph, Object.fromEntries(graph.nodes.map((n) => [n.key, { x: 7, y: 8 }])));
    expect(movedPositions(nodes)).toEqual({ CP: { x: 7, y: 8 }, 'A-1': { x: 7, y: 8 }, 'B-10': { x: 7, y: 8 }, 'B-2': { x: 7, y: 8 } });
  });
});
