import { describe, expect, it } from 'vitest';
import { findSmells } from '../../src/core/smells';
import type { GsCard, GsFrame, GsLink } from '../../src/core/gsmap';
import { groupSmellsForPanel, SMELL_GROUPS } from '../../src/ui/model';
import { frameContents, junctionRect, junctionsOf, toFlowJunctions } from '../../src/ui/model';
import { cardNodeId, cssColor, endpointNodeId, dragCompanions, frameNodeId, isCardNode, isFrameNode, isStrategyNode, toFlowCards, toFlowFrames, toFlowLinks, groupSmells, localToday, movedPositions, sidesOf, titleOf, toFlowEdges, toFlowNodes, unsavedPositions, unverifiedServes } from '../../src/ui/model';
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
    expect(nodes.every((n) => n.connectable === true && n.deletable === false)).toBe(true);
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

describe('"AND" junctions (bug 7)', () => {
  const vault = {
    'Strategy/FP-1.md': md({ id: 'FP-1', type: 'fixed-point', requires: ['[[B-3]]', '[[B-5]]'] }),
    'Strategy/B-3.md': md({ id: 'B-3', type: 'bet', status: 'active', serves: ['[[B-4]]', '[[FP-1]]'] }),
    'Strategy/B-4.md': md({ id: 'B-4', type: 'bet', status: 'active', requires: ['[[B-3]]', '[[B-5]]', '[[B-1]]'] }),
    'Strategy/B-5.md': md({ id: 'B-5', type: 'bet', status: 'active', serves: ['[[B-4]]'] }),
    'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', status: 'active' }),
    'Strategy/B-6.md': md({ id: 'B-6', type: 'bet', status: 'active', requires: ['[[B-1]]'] }),
  };
  const at = { 'B-1': { x: 0, y: 300 }, 'B-3': { x: 0, y: 0 }, 'B-5': { x: 0, y: 150 }, 'B-4': { x: 400, y: 100 }, 'B-6': { x: 400, y: 400 }, 'FP-1': { x: 800, y: 0 } };

  it('puts one in front of every note with two or more requires, a fixed point too, and none for one', async () => {
    const graph = await graphOf(vault);
    const junctions = junctionsOf(graph);
    expect([...junctions.keys()].sort()).toEqual(['B-4', 'FP-1']);
    expect(junctions.get('B-4')!.prerequisites.sort()).toEqual(['B-1', 'B-3', 'B-5']);
  });

  it('places it just left of its holder, level with its middle, and moves it with the holder only', async () => {
    const graph = await graphOf(vault);
    const [and] = toFlowJunctions(graph, junctionsOf(graph), at).filter((n) => n.id === 'and:B-4');
    const rect = junctionRect({ ...at['B-4'], width: 240, height: 84 });
    expect(and).toMatchObject({ type: 'junction', position: { x: rect.x, y: rect.y }, draggable: false, selectable: false, deletable: false });
    expect(rect.x + rect.width).toBeLessThan(400);
    expect(rect.y + rect.height / 2).toBe(100 + 42);
    // A prerequisite moving changes nothing; the holder moving takes it along.
    const moved = toFlowJunctions(graph, junctionsOf(graph), { ...at, 'B-3': { x: -500, y: -500 }, 'B-4': { x: 600, y: 100 } }).find((n) => n.id === 'and:B-4')!;
    expect(moved.position).toEqual({ x: rect.x + 200, y: rect.y });
    // Its holder not shown yet: no junction.
    expect(toFlowJunctions(graph, junctionsOf(graph), { 'B-3': at['B-3'] })).toEqual([]);
  });

  it('runs the requires into the junction and one link from it to the holder, and draws a serves twin of a requires once', async () => {
    const graph = await graphOf(vault);
    const edges = toFlowEdges(graph, at, { junctions: junctionsOf(graph) });
    const by = Object.fromEntries(edges.map((e) => [e.id, e]));
    expect(by['requires:B-4>B-3']).toMatchObject({ source: 'B-3', target: 'and:B-4', hidden: false });
    expect(by['requires:B-4>B-3'].markerEnd).toBeUndefined();
    expect(by['and:B-4>']).toMatchObject({ source: 'and:B-4', target: 'B-4', sourceHandle: 'right-source', targetHandle: 'left-target', selectable: false, deletable: false, markerEnd: { type: 'arrowclosed' } });
    expect(by['requires:FP-1>B-5']).toMatchObject({ target: 'and:FP-1' });
    // B-3 serves B-4 and B-4 requires B-3: one line, not two.
    expect(by['serves:B-3>B-4'].hidden).toBe(true);
    expect(by['serves:B-3>FP-1'].hidden).toBe(true);
    // One requires: straight into the holder, with its arrow.
    expect(by['requires:B-6>B-1']).toMatchObject({ source: 'B-1', target: 'B-6', markerEnd: { type: 'arrowclosed' } });
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

describe('dragCompanions', () => {
  const box = (x: number, y: number) => ({ x, y, width: 200, height: 80 });
  // B-1 → B-2 → B-4 (B-4 requires B-2, B-2 requires B-1), A-1 sits on B-2; B-3 is required by B-4 but was right of it.
  const start = new Map([
    ['B-1', box(0, 0)], ['B-2', box(300, 0)], ['B-4', box(600, 0)], ['A-1', box(300, -120)], ['B-3', box(900, 200)], ['FP-1', box(-400, 0)],
  ]);
  const input = {
    satellites: new Map([['B-2', ['A-1']]]),
    requires: new Map([['B-4', ['B-2', 'B-3']], ['B-2', ['B-1', 'FP-1']]]),
    start,
    movable: new Set(['B-1', 'B-2', 'B-4', 'A-1', 'B-3']),
  };
  const run = (moved: Record<string, { x: number; y: number }>) => Object.fromEntries(dragCompanions({ ...input, moved: new Map(Object.entries(moved)) }));

  it('leaves prerequisites alone while the dragged note keeps its distance, and never moves them up or down', () => {
    expect(run({ 'B-4': { x: 900, y: 400 } })).toEqual({});
    expect(run({ 'B-4': { x: 600, y: -300 } })).toEqual({});
  });

  it('pushes the requires chain left, horizontally only, keeping the gap each had (a column at most)', () => {
    // B-4 to x 450: B-2 must end 100 before it (its gap was 100), B-1 100 before B-2, and A-1 goes with B-2.
    expect(run({ 'B-4': { x: 450, y: 50 } })).toEqual({ 'B-2': { x: 150, y: 0 }, 'B-1': { x: -150, y: 0 }, 'A-1': { x: 150, y: -120 } });
  });

  it('does not push what was not left of its note, what is fixed, or what is being dragged too', () => {
    const pushed = run({ 'B-4': { x: 0, y: 0 } });
    expect(pushed['B-3']).toBeUndefined();
    expect(pushed['FP-1']).toBeUndefined();
    expect(run({ 'B-4': { x: 450, y: 0 }, 'B-2': { x: 300, y: 0 } })).toEqual({ 'A-1': { x: 300, y: -120 } });
  });

  it('moves the assumptions a dragged note hosts by the same amount', () => {
    expect(run({ 'B-2': { x: 320, y: 40 } })).toEqual({ 'A-1': { x: 320, y: -80 } });
  });
});

describe('frameContents (bug 1)', () => {
  it('carries what lies wholly inside a dragged frame, nested frames included, and nothing that only overlaps it', () => {
    const frames = new Map([['frame:a', { x: 0, y: 0, width: 1000, height: 600 }]]);
    const items = new Map([
      ['B-1', { x: 10, y: 10, width: 240, height: 84 }],
      ['card:c', { x: 900, y: 500, width: 100, height: 100 }],
      ['frame:b', { x: 500, y: 300, width: 200, height: 200 }],
      ['B-2', { x: 900, y: 500, width: 240, height: 84 }],
      ['B-3', { x: 2000, y: 0, width: 240, height: 84 }],
    ]);
    expect(Object.fromEntries(frameContents(frames, items))).toEqual({ 'B-1': 'frame:a', 'card:c': 'frame:a', 'frame:b': 'frame:a' });
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

describe('free cards, frames and links (Phase 7)', () => {
  const card: GsCard = { id: 'c1', kind: 'text', text: 'idea', x: 10, y: 20, width: 250, height: 60, color: '2' };
  const frame: GsFrame = { id: 'f1', label: 'Visa route', x: -100, y: -100, width: 1800, height: 900 };

  it('draws cards and frames as nodes whose ids cannot be a note key, frames behind everything', () => {
    const [c] = toFlowCards([card], true);
    expect(c).toMatchObject({ id: 'card:c1', type: 'card', position: { x: 10, y: 20 }, width: 250, height: 60, draggable: true, deletable: true });
    const [f] = toFlowFrames([frame], true);
    expect(f).toMatchObject({ id: 'frame:f1', type: 'frame', zIndex: -1, draggable: true, deletable: true, connectable: false });
    expect(cardNodeId('x')).toBe('card:x');
    expect(frameNodeId('x')).toBe('frame:x');
    expect(isCardNode(c) && !isFrameNode(c) && !isStrategyNode(c)).toBe(true);
  });

  it('cannot move or delete them when the map cannot be written', () => {
    expect(toFlowCards([card], false)[0]).toMatchObject({ draggable: false, deletable: false });
    expect(toFlowFrames([frame], false)[0]).toMatchObject({ draggable: false, deletable: false });
  });

  it('maps the canvas colour presets and hex colours, and nothing else', () => {
    expect(cssColor('1')).toContain('--color-red');
    expect(cssColor('6')).toContain('--color-purple');
    expect(cssColor('#a1b2c3')).toBe('#a1b2c3');
    expect(cssColor('red')).toBeUndefined();
    expect(cssColor(undefined)).toBeUndefined();
  });

  const rects = new Map([
    ['card:c1', { x: 0, y: 0, width: 250, height: 60 }],
    ['B-1', { x: 400, y: 0, width: 240, height: 84 }],
  ]);
  const link = (extra: Partial<GsLink> = {}): GsLink => ({ id: 'l1', from: { card: 'c1' }, to: { note: 'B-1' }, ...extra });

  it('draws a link between a card and a note, with the canvas\'s sides, dashes, colour, label and ends', () => {
    expect(endpointNodeId({ card: 'c1' })).toBe('card:c1');
    expect(endpointNodeId({ note: 'B-1' })).toBe('B-1');
    const [plain] = toFlowLinks([link()], rects, true);
    expect(plain).toMatchObject({ id: 'link:l1', source: 'card:c1', target: 'B-1', sourceHandle: 'right-source', targetHandle: 'left-target', className: 'gs-link', selectable: true, deletable: true });
    expect(plain.markerEnd).toBeDefined();
    expect(plain.markerStart).toBeUndefined();
    const [styled] = toFlowLinks(
      [link({ label: 'Only A-6', color: '4', fromSide: 'bottom', toSide: 'top', style: { path: 'long-dashed', pathfindingMethod: 'square' }, fromEnd: 'arrow', toEnd: 'none' })],
      rects,
      true
    );
    expect(styled).toMatchObject({ label: 'Only A-6', sourceHandle: 'bottom-source', targetHandle: 'top-target', type: 'smoothstep', className: 'gs-link gs-link--long-dashed' });
    expect(styled.style?.stroke).toContain('--color-green');
    expect(styled.markerStart).toBeDefined();
    expect(styled.markerEnd).toBeUndefined();
  });

  it('leaves out a link whose end is not on the graph, and makes none selectable when read-only', () => {
    expect(toFlowLinks([link({ to: { note: 'B-404' } })], rects, true)).toEqual([]);
    expect(toFlowLinks([link()], rects, false)[0]).toMatchObject({ selectable: false, deletable: false });
  });
});

describe('smells panel groups (Phase 8)', () => {
  it('lists every smell code the core can produce, worst first, and leaves empty groups out', async () => {
    const graph = await graphOf(files);
    const smells = findSmells(graph, { today: '2026-10-01' });
    const groups = groupSmellsForPanel(smells);
    expect(groups.map((g) => g.code)).toEqual(['gating-violation', 'orphan-bet']);
    expect(groups.find((g) => g.code === 'orphan-bet')!.smells.map((s) => s.node)).toEqual(['B-2', 'No id.md'.replace(/^/, 'Strategy/')]);
    expect(groupSmellsForPanel([])).toEqual([]);
  });

  it('has a title for each of the core\'s smell codes, no more and no fewer', () => {
    expect(SMELL_GROUPS.map((g) => g.code).sort()).toEqual(
      ['dormant-not-next', 'falsified-dependency', 'gating-violation', 'orphan-bet', 'overdue-bet', 'requires-open-milestone', 'unreached-fixed-point'].sort()
    );
  });
});
