import { describe, expect, it } from 'vitest';
import { findSmells } from '../../src/core/smells';
import { followersOf, groupSmells, localToday, movedPositions, sidesOf, titleOf, toFlowEdges, toFlowNodes, unsavedPositions, unverifiedServes } from '../../src/ui/model';
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

describe('unsavedPositions', () => {
  it('pins every shown node with a usable id and no saved position, fixed points included', async () => {
    const graph = await graphOf(files);
    const shown = Object.fromEntries(graph.nodes.filter((n) => n.key !== 'B-2').map((n) => [n.key, { x: 7, y: 8 }]));
    const nodes = toFlowNodes(graph, shown); // B-2 has no place yet: hidden
    expect(unsavedPositions(nodes, { 'B-10': { x: 0, y: 0 } })).toEqual({
      CP: { x: 7, y: 8 },
      'FP-1': { x: 7, y: 8 },
      'A-1': { x: 7, y: 8 },
    });
  });
});

describe('smell badges (Phase 5b)', () => {
  it('puts each node\'s smells in its data', async () => {
    const graph = await graphOf(files);
    const smells = findSmells(graph, { today: '2026-10-01' });
    const by = Object.fromEntries(toFlowNodes(graph, {}, smells).map((n) => [n.id, n.data.smells.map((s) => s.code)]));
    expect(by['B-2']).toEqual(['orphan-bet']);
    expect(by['B-10']).toEqual(['gating-violation']);
    expect(by['FP-1']).toEqual([]);
    expect(toFlowNodes(graph, {}).every((n) => n.data.smells.length === 0)).toBe(true); // no smells given, no badges
  });

  it('groups smells by node', () => {
    const smell = (node: string, code: 'orphan-bet' | 'overdue-bet') => ({ code, node, message: '', related: [] });
    const grouped = groupSmells([smell('B-1', 'orphan-bet'), smell('B-2', 'orphan-bet'), smell('B-1', 'overdue-bet')]);
    expect(grouped.get('B-1')?.map((s) => s.code)).toEqual(['orphan-bet', 'overdue-bet']);
    expect(grouped.get('B-2')).toHaveLength(1);
  });
});

describe('edge styles (Phase 5b)', () => {
  const vault = {
    'Strategy/FP-1 Live.md': md({ id: 'FP-1', type: 'fixed-point' }),
    'Strategy/A-1 Rent.md': md({ id: 'A-1', type: 'assumption', status: 'unverified' }),
    'Strategy/A-2 Sure.md': md({ id: 'A-2', type: 'assumption', status: 'confirmed' }),
    'Strategy/B-1 Shaky.md': md({ id: 'B-1', type: 'bet', status: 'active', serves: ['[[FP-1 Live]]'], assumptions: ['[[A-1 Rent]]', '[[A-2 Sure]]'] }),
    'Strategy/B-2 Solid.md': md({ id: 'B-2', type: 'bet', status: 'active', serves: ['[[FP-1 Live]]'], assumptions: ['[[A-2 Sure]]'] }),
    'Strategy/B-3 Bare.md': md({ id: 'B-3', type: 'bet', status: 'active', serves: ['[[FP-1 Live]]'] }),
    'Strategy/B-4 Chainless.md': md({ id: 'B-4', type: 'bet', status: 'active', 'ultimately-serves': ['[[FP-1 Live]]'] }),
    'Strategy/B-5 Chained.md': md({ id: 'B-5', type: 'bet', status: 'active', serves: ['[[B-3 Bare]]'], 'ultimately-serves': ['[[FP-1 Live]]'] }),
  };

  it('dashes a serve whose holder leans on an assumption that is not confirmed', async () => {
    const graph = await graphOf(vault);
    expect(Array.from(unverifiedServes(graph))).toEqual(['serves:B-1>FP-1']);
    const classes = Object.fromEntries(toFlowEdges(graph, {}).map((e) => [e.id, e.className]));
    expect(classes['serves:B-1>FP-1']).toBe('gs-edge gs-edge-serves gs-edge-unverified');
    expect(classes['serves:B-2>FP-1']).toBe('gs-edge gs-edge-serves');
    expect(classes['serves:B-3>FP-1']).toBe('gs-edge gs-edge-serves');
  });

  it('shows ultimately-serves on the toggle, or for a bet with no serves chain', async () => {
    const graph = await graphOf(vault);
    const hidden = (view = {}) => Object.fromEntries(toFlowEdges(graph, {}, view).filter((e) => e.data?.kind === 'ultimately-serves').map((e) => [e.source, e.hidden]));
    expect(hidden()).toEqual({ 'B-4': true, 'B-5': true });
    expect(hidden({ showUltimate: true })).toEqual({ 'B-4': false, 'B-5': false });
    const smells = findSmells(graph, { today: '2026-10-01' });
    expect(hidden({ smells })).toEqual({ 'B-4': false, 'B-5': true }); // B-5's chain reaches FP-1 already
  });

  it('labels the ultimately-serves edge', async () => {
    const edges = toFlowEdges(await graphOf(vault), {}, { showUltimate: true });
    expect(edges.find((e) => e.data?.kind === 'ultimately-serves')?.label).toBe('ultimately');
  });
});

describe('localToday', () => {
  it('is the local date as YYYY-MM-DD', () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
