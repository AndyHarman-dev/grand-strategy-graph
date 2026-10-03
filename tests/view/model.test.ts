import { describe, expect, it } from 'vitest';
import { followersOf, movedPositions, sidesOf, titleOf, toFlowEdges, toFlowNodes } from '../../src/ui/model';
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
  it('draws from the earlier end, labels next, hides ultimately-serves, drops the arrow on assumptions', async () => {
    const graph = await graphOf(files);
    const edges = toFlowEdges(graph, {});
    const by = Object.fromEntries(edges.map((e) => [e.id, e]));
    expect(by['serves:B-10>FP-1']).toMatchObject({ source: 'B-10', target: 'FP-1', hidden: false, markerEnd: { type: 'arrowclosed' } });
    expect(by['requires:B-10>B-2']).toMatchObject({ source: 'B-2', target: 'B-10', className: 'gs-edge gs-edge-requires' });
    expect(by['next:B-10>B-2']).toMatchObject({ source: 'B-10', target: 'B-2', label: 'on kill' });
    expect(by['assumption:B-10>A-1']).toMatchObject({ source: 'A-1', target: 'B-10' });
    expect(by['assumption:B-10>A-1'].markerEnd).toBeUndefined();
    expect(by['ultimately-serves:B-10>FP-1'].hidden).toBe(true);
  });

  it('attaches each edge to the sides that face each other (D19)', async () => {
    const graph = await graphOf(files);
    const edges = toFlowEdges(graph, {
      'B-10': { x: 0, y: 0 },
      'FP-1': { x: 400, y: 300 }, // right and well below: still left→right, it runs along time
      'A-1': { x: 10, y: -150 }, // above
      'B-2': { x: 0, y: 130 }, // the sequel, below
    });
    const sides = Object.fromEntries(edges.map((e) => [e.id, [e.sourceHandle, e.targetHandle]]));
    expect(sides['serves:B-10>FP-1']).toEqual(['right-source', 'left-target']);
    expect(sides['assumption:B-10>A-1']).toEqual(['bottom-source', 'top-target']);
    expect(sides['next:B-10>B-2']).toEqual(['bottom-source', 'top-target']);
    expect(sides['requires:B-10>B-2']).toEqual(['top-source', 'bottom-target']); // same column: no way across
  });

  it('leaves the sides to React Flow while an end has no position', async () => {
    const [edge] = toFlowEdges(await graphOf(files), { 'B-10': { x: 0, y: 0 } });
    expect(edge.sourceHandle).toBeUndefined();
  });
});

describe('sidesOf', () => {
  const box = (x: number, y: number) => ({ x, y, width: 200, height: 80 });
  it('goes across when the boxes are further apart across, up and down otherwise', () => {
    expect(sidesOf(box(0, 0), box(300, 50))).toEqual({ source: 'right', target: 'left' });
    expect(sidesOf(box(300, 0), box(0, 50))).toEqual({ source: 'left', target: 'right' });
    expect(sidesOf(box(0, 0), box(150, 200))).toEqual({ source: 'bottom', target: 'top' });
    expect(sidesOf(box(0, 200), box(150, 0))).toEqual({ source: 'top', target: 'bottom' });
    expect(sidesOf(box(0, 0), box(150, 200), true)).toEqual({ source: 'right', target: 'left' });
  });
});

describe('followersOf', () => {
  it('moves the assumptions hosted by a dragged node, unless they are dragged themselves', () => {
    const satellites = new Map([['B-1', ['A-1', 'A-2']], ['B-2', ['A-3']]]);
    expect(Object.fromEntries(followersOf(satellites, ['B-1', 'A-2']))).toEqual({ 'A-1': 'B-1' });
    expect(Object.fromEntries(followersOf(satellites, ['A-3']))).toEqual({});
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
