import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GSMAP_PATH, parseGsMap, serializeGsMap, emptyGsMap } from '../../src/core/gsmap';
import { followRenameInMaps, isGraphNote, openStrategyGraph, revealInStrategyGraph } from '../../src/obsidian/graph-commands';
import { StrategyGraphView } from '../../src/obsidian/graph-view';
import { plannedTestVault } from '../../tools/test-vault';
import { notices, openedModals, rendered, resetObsidianMock } from '../mocks/obsidian';
import { FakeWorkspaceApp, type MountRecord } from '../support/fake-workspace';
import { md } from '../support/v2';

const B1 = 'Strategy/Bets/B-1 Get a D7 visa.md';
const B7 = 'Strategy/Bets/B-7  Part-time barista job.md';

let app: FakeWorkspaceApp;

beforeEach(() => {
  resetObsidianMock();
  vi.useFakeTimers();
  app = new FakeWorkspaceApp(plannedTestVault());
});

afterEach(() => {
  vi.useRealTimers();
});

const lastState = (mount: MountRecord) => mount.renders[mount.renders.length - 1].state;
const nodeKeys = (mount: MountRecord) => lastState(mount).graph!.nodes.map((n) => n.key);
const positionsOnDisk = () => {
  const read = parseGsMap(app.vault.text(GSMAP_PATH));
  if (!read.ok) throw new Error(read.error);
  return read.map.positions;
};
const listeners = () => app.vault.listenerCount() + app.metadataCache.listenerCount();

async function open() {
  const view = await openStrategyGraph(app as never);
  expect(view).toBeInstanceOf(StrategyGraphView);
  return { view: view!, mount: app.mounts[app.mounts.length - 1], leaf: app.leaves[app.leaves.length - 1] };
}

describe('opening Strategy.gsmap', () => {
  it('mounts the graph once, built from the metadata cache, with the saved positions', async () => {
    const { mount } = await open();
    expect(app.mounts).toHaveLength(1);
    const state = lastState(mount);
    expect(state.graph!.nodes).toHaveLength(18);
    expect(state.map!.positions['B-1']).toEqual({ x: 300, y: 0 });
    expect(state.mapError).toBeNull();
    // The phantom FP-2 link, kept as is by the migration (D13), is listed as a warning.
    expect(state.notices.map((n) => n.severity)).toEqual(['warning']);
  });

  it('creates an empty Strategy.gsmap when the vault has none', async () => {
    app = new FakeWorkspaceApp({ 'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', status: 'active' }) });
    const { mount } = await open();
    expect(app.vault.text(GSMAP_PATH)).toBe(serializeGsMap(emptyGsMap()));
    expect(notices.map((n) => n.message)).toEqual([`Created ${GSMAP_PATH}.`]);
    expect(nodeKeys(mount)).toEqual(['B-1']);
  });

  it('focuses the open graph tab instead of opening a second one', async () => {
    const first = await open();
    const again = await openStrategyGraph(app as never);
    expect(again).toBe(first.view);
    expect(app.leaves).toHaveLength(1);
    expect(app.mounts).toHaveLength(1);
    expect(app.revealed).toEqual([first.leaf]);
  });
});

describe('re-deriving the graph', () => {
  it('rebuilds once after a burst of note changes', async () => {
    const { mount } = await open();
    const renders = mount.renders.length;
    app.vault.write('Strategy/Bets/B-9 New.md', md({ id: 'B-9', type: 'bet', status: 'active' }), app.metadataCache);
    app.vault.write('Strategy/Bets/B-10 Newer.md', md({ id: 'B-10', type: 'bet', status: 'active' }), app.metadataCache);
    await vi.advanceTimersByTimeAsync(100);
    expect(mount.renders.length).toBe(renders);
    await vi.advanceTimersByTimeAsync(300);
    expect(mount.renders.length).toBe(renders + 1);
    expect(nodeKeys(mount)).toContain('B-9');
    expect(nodeKeys(mount)).toContain('B-10');
  });

  it('does not re-render when a change leaves the graph as it was', async () => {
    const { mount } = await open();
    const renders = mount.renders.length;
    app.vault.write('lisbon-neighbourhoods-research.md', 'still not a strategy note', app.metadataCache);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mount.renders.length).toBe(renders);
  });

  it('drops a deleted note', async () => {
    const { mount } = await open();
    app.vault.remove(B7, app.metadataCache);
    await vi.advanceTimersByTimeAsync(1000);
    expect(nodeKeys(mount)).not.toContain('B-7');
  });

  it('a rename needs no handling: same id, same saved position, no report', async () => {
    const { mount } = await open();
    app.vault.rename(B1, 'Strategy/Bets/B-1 Get a D7 visa (renamed).md', app.metadataCache);
    await vi.advanceTimersByTimeAsync(1000);
    const node = lastState(mount).graph!.nodes.find((n) => n.key === 'B-1')!;
    expect(node.path).toBe('Strategy/Bets/B-1 Get a D7 visa (renamed).md');
    expect(lastState(mount).map!.positions['B-1']).toEqual({ x: 300, y: 0 });
    expect(notices).toEqual([]);
  });

  it('reports a note whose id changes, on the graph and as a notice', async () => {
    const { mount } = await open();
    app.vault.write(B1, app.vault.text(B1).replace('id: B-1', 'id: B-11'), app.metadataCache);
    await vi.advanceTimersByTimeAsync(1000);
    const expected =
      'B-1 Get a D7 visa changed id from "B-1" to "B-11". Its saved position stays under "B-1" in Strategy.gsmap, so the node is placed automatically until you drag it.';
    expect(notices.map((n) => n.message)).toEqual([expected]);
    expect(lastState(mount).notices).toContainEqual({ severity: 'warning', path: B1, message: expected });
    // Changing it back clears the report.
    app.vault.write(B1, app.vault.text(B1).replace('id: B-11', 'id: B-1'), app.metadataCache);
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastState(mount).notices.filter((n) => n.path === B1)).toEqual([]);
  });

  it('picks up a .gsmap changed elsewhere (Sync)', async () => {
    const { mount } = await open();
    const text = JSON.parse(app.vault.text(GSMAP_PATH));
    text.positions['B-1'] = { x: 1, y: 2 };
    app.vault.write(GSMAP_PATH, JSON.stringify(text));
    await vi.advanceTimersByTimeAsync(0);
    expect(lastState(mount).map!.positions['B-1']).toEqual({ x: 1, y: 2 });
  });
});

describe('saving positions', () => {
  it('writes moved nodes on drag end, after a quiet period, through vault.process, changing nothing else', async () => {
    const { mount } = await open();
    const before = app.vault.text(GSMAP_PATH);
    expect(mount.host.move({ 'B-1': { x: 320.4, y: 10 }, 'A-1': { x: -60, y: -40 } })).toBe(true);
    expect(lastState(mount).map!.positions['B-1']).toEqual({ x: 320, y: 10 });
    expect(app.vault.processed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.vault.processed).toHaveLength(1);
    const after = positionsOnDisk();
    expect(after['B-1']).toEqual({ x: 320, y: 10 });
    expect(after['A-1']).toEqual({ x: -60, y: -40 });
    const untouched = JSON.parse(before);
    untouched.positions['B-1'] = after['B-1'];
    untouched.positions['A-1'] = after['A-1'];
    expect(JSON.parse(app.vault.text(GSMAP_PATH))).toEqual(untouched);
  });

  it('keeps a position written to disk elsewhere meanwhile', async () => {
    const { mount } = await open();
    mount.host.move({ 'B-1': { x: 1, y: 1 } });
    const text = JSON.parse(app.vault.text(GSMAP_PATH));
    text.positions['B-2'] = { x: 2, y: 2 };
    app.vault.write(GSMAP_PATH, JSON.stringify(text));
    await vi.advanceTimersByTimeAsync(1000);
    expect(positionsOnDisk()['B-1']).toEqual({ x: 1, y: 1 });
    expect(positionsOnDisk()['B-2']).toEqual({ x: 2, y: 2 });
  });

  it('refuses to save into a .gsmap it cannot read, and says so', async () => {
    app.vault.files.get(GSMAP_PATH)!.text = '{"version": 2, "positions": {}}';
    const { mount } = await open();
    expect(lastState(mount).mapError).toMatch(/newer plugin/);
    expect(lastState(mount).notices[0]).toMatchObject({ severity: 'error' });
    expect(mount.host.move({ 'B-1': { x: 1, y: 1 } })).toBe(false);
    expect(notices.map((n) => n.message)).toEqual(["Strategy graph: Strategy.gsmap can't be read, so positions are not saved."]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.vault.processed).toHaveLength(0);
  });

  it('reports a failed write and keeps the position for the next one', async () => {
    const { mount } = await open();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app.vault.failProcess = true;
    mount.host.move({ 'B-1': { x: 5, y: 5 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(notices.map((n) => n.message)).toEqual(['Strategy graph: positions not saved. Simulated write failure.']);
    app.vault.failProcess = false;
    mount.host.move({ 'B-2': { x: 6, y: 6 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(positionsOnDisk()['B-1']).toEqual({ x: 5, y: 5 });
    expect(positionsOnDisk()['B-2']).toEqual({ x: 6, y: 6 });
  });
});

describe('resetting positions', () => {
  it('empties positions in the .gsmap through vault.process, at once, changing nothing else', async () => {
    const { mount } = await open();
    const before = JSON.parse(app.vault.text(GSMAP_PATH));
    expect(Object.keys(before.positions).length).toBeGreaterThan(0);
    mount.host.move({ 'B-1': { x: 1, y: 1 } });
    expect(mount.host.resetPositions()).toBe(true);
    expect(lastState(mount).map!.positions).toEqual({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.vault.processed).toHaveLength(1);
    expect(JSON.parse(app.vault.text(GSMAP_PATH))).toEqual({ ...before, positions: {} });
    expect(lastState(mount).map!.positions).toEqual({});
  });

  it('refuses to reset a .gsmap it cannot read, and says so', async () => {
    app.vault.files.get(GSMAP_PATH)!.text = '{"version": 2, "positions": {}}';
    const { mount } = await open();
    expect(mount.host.resetPositions()).toBe(false);
    expect(notices.map((n) => n.message)).toEqual(["Strategy graph: Strategy.gsmap can't be read, so positions can't be reset."]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.vault.processed).toHaveLength(0);
  });
});

describe('closing the tab', () => {
  it('writes a pending move, unmounts React and releases every event handler', async () => {
    const idle = listeners();
    const { mount, leaf } = await open();
    expect(listeners()).toBeGreaterThan(idle);
    mount.host.move({ 'B-1': { x: 9, y: 9 } });
    await leaf.detach();
    expect(positionsOnDisk()['B-1']).toEqual({ x: 9, y: 9 });
    expect(mount.unmounted).toBe(true);
    expect(listeners()).toBe(idle);
    // Nothing reacts any more.
    const renders = mount.renders.length;
    app.vault.write(B1, app.vault.text(B1).replace('status: active', 'status: won'), app.metadataCache);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mount.renders.length).toBe(renders);
  });

  it('a rebuild still in flight when the tab closes renders nothing', async () => {
    const { mount, leaf } = await open();
    app.vault.write(B1, app.vault.text(B1).replace('status: active', 'status: won'), app.metadataCache);
    const renders = mount.renders.length;
    await leaf.detach();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mount.renders.length).toBe(renders);
  });

  it('opening another .gsmap in the same tab lets go of the first one cleanly', async () => {
    const { mount, leaf } = await open();
    mount.host.move({ 'B-1': { x: 4, y: 4 } });
    await app.vault.create('Strategy/Other.gsmap', '');
    await leaf.openFile(app.file('Strategy/Other.gsmap'));
    expect(positionsOnDisk()['B-1']).toEqual({ x: 4, y: 4 });
    expect(mount.unmounted).toBe(true);
    expect(app.mounts).toHaveLength(2);
    expect(lastState(app.mounts[1]).map!.positions).toEqual({});
  });
});

describe('Reveal note in graph', () => {
  it('opens the graph and asks it to center on the note', async () => {
    await revealInStrategyGraph(app as never, app.file(B1) as never);
    const mount = app.mounts[0];
    expect(mount.renders[mount.renders.length - 1].reveal).toEqual({ key: 'B-1', nonce: 1 });
    await revealInStrategyGraph(app as never, app.file(B1) as never);
    expect(app.mounts).toHaveLength(1);
    expect(mount.renders[mount.renders.length - 1].reveal).toEqual({ key: 'B-1', nonce: 2 });
  });

  it('says so for a note that is not on the graph', async () => {
    const { view } = await open();
    expect(view.revealPath('Strategy/Strategic Inbox.md')).toBe(false);
    expect(notices.map((n) => n.message)).toEqual(['Not on the strategy graph: Strategy/Strategic Inbox.md']);
  });

  it('is offered only for notes with a graph type', () => {
    expect(isGraphNote(app as never, app.file(B1) as never)).toBe(true);
    expect(isGraphNote(app as never, app.file('Strategy/Strategic Inbox.md') as never)).toBe(false);
    expect(isGraphNote(app as never, app.file(GSMAP_PATH) as never)).toBe(false);
    expect(isGraphNote(app as never, null)).toBe(false);
  });
});

describe('opening a note from the graph', () => {
  it('never replaces the graph tab', async () => {
    const { mount } = await open();
    mount.host.openNote!(B1, false);
    mount.host.openNote!(B1, true);
    expect(app.opened).toEqual([
      { path: B1, how: 'tab' },
      { path: B1, how: 'split' },
    ]);
  });
});

describe('putting notes on the graph as note cards (bug 2)', () => {
  const LISBON = 'lisbon-neighbourhoods-research.md';
  const drop = (text = '') => ({ dataTransfer: { getData: (type: string) => (type === 'text/plain' ? text : '') } }) as unknown as DragEvent;

  it('"Add note card…" opens the note picker over every note and calls back with the path picked', async () => {
    const { mount } = await open();
    const picked: string[] = [];
    mount.host.pickNote!((path) => picked.push(path));
    const modal = openedModals[openedModals.length - 1] as unknown as { getItems(): { path: string }[]; onChooseItem(file: unknown): void };
    expect(modal.getItems().map((f) => f.path)).toContain(LISBON);
    modal.onChooseItem(app.vault.getAbstractFileByPath(LISBON));
    expect(picked).toEqual([LISBON]);
  });

  it('reads the dragged files off the file explorer\'s drag manager', async () => {
    const { mount } = await open();
    const file = app.vault.getAbstractFileByPath(LISBON);
    (app as unknown as { dragManager: unknown }).dragManager = { draggable: { type: 'file', file } };
    expect(mount.host.droppedNotes!(drop())).toEqual([LISBON]);
    (app as unknown as { dragManager: unknown }).dragManager = { draggable: { type: 'files', files: [file, app.vault.getAbstractFileByPath(B1)] } };
    expect(mount.host.droppedNotes!(drop())).toEqual([LISBON, B1]);
  });

  const noteCards = () => {
    const read = parseGsMap(app.vault.text(GSMAP_PATH));
    if (!read.ok) throw new Error(read.error);
    return read.map.cards.flatMap((c) => (c.kind === 'note-ref' ? [c.file] : []));
  };

  it('a note card follows its note when it is renamed or moved, with the graph open (as on a canvas)', async () => {
    const { mount, view } = await open();
    expect(noteCards()).toEqual([LISBON]);
    app.vault.rename(LISBON, 'Research/Lisbon neighbourhoods.md', app.metadataCache);
    const shown = lastState(mount).map!.cards.find((c) => c.kind === 'note-ref');
    expect(shown).toMatchObject({ file: 'Research/Lisbon neighbourhoods.md' }); // at once
    // The plugin-wide follower leaves an open map to its tab, so nothing is written twice.
    await followRenameInMaps(app as never, LISBON, 'Research/Lisbon neighbourhoods.md');
    expect(app.vault.processed).toEqual([]);
    await view.onUnloadFile(view.file!); // closing writes what is pending
    expect(noteCards()).toEqual(['Research/Lisbon neighbourhoods.md']);
    expect(app.vault.processed).toHaveLength(1);
  });

  it('a note card follows its note when it is renamed with the graph closed, and a map no card names is left alone', async () => {
    app.vault.rename(LISBON, 'Research/Lisbon.md');
    await followRenameInMaps(app as never, LISBON, 'Research/Lisbon.md');
    expect(noteCards()).toEqual(['Research/Lisbon.md']);
    expect(app.vault.processed.map((p) => p.path)).toEqual([GSMAP_PATH]);
    const before = app.vault.text(GSMAP_PATH);
    await followRenameInMaps(app as never, B1, 'Strategy/Bets/B-1 renamed.md');
    expect(app.vault.processed).toHaveLength(1);
    expect(app.vault.text(GSMAP_PATH)).toBe(before);
  });

  it('falls back to an obsidian:// URL or a link in the dropped text, and finds nothing in other text', async () => {
    const { mount } = await open();
    expect(mount.host.droppedNotes!(drop('obsidian://open?vault=test&file=lisbon-neighbourhoods-research'))).toEqual([LISBON]);
    expect(mount.host.droppedNotes!(drop('[[B-1 Get a D7 visa]]'))).toEqual([B1]);
    expect(mount.host.droppedNotes!(drop('just some words'))).toEqual([]);
    expect(mount.host.droppedNotes!(drop('obsidian://open?vault=test&file=No%20such%20note'))).toEqual([]);
  });
});

describe('hovering a node (Phase 5b)', () => {
  it('asks Obsidian for the page preview of the note, as a hover-link from the graph view', async () => {
    const { view, mount } = await open();
    const event = { type: 'mouseover' } as MouseEvent;
    const targetEl = {} as HTMLElement;
    mount.host.hoverNote!(event, targetEl, B1);
    expect(app.triggered).toEqual([{ name: 'hover-link', args: [{ event, source: 'strategy-graph', hoverParent: view, targetEl, linktext: B1 }] }]);
  });

  it('gives the graph the local date for the overdue smell', async () => {
    const { mount } = await open();
    expect(mount.host.today!()).toBe('2026-10-01'); // the obsidian mock's clock
  });
});

describe('editing from the graph (Phase 6)', () => {
  const B3 = 'Strategy/Bets/B-3 Sell pottery at weekend markets.md';

  /** An edit that changes the graph resolves after the rebuild it causes (250 ms): run it with the clock moving. */
  async function edit(mount: MountRecord, intent: Parameters<NonNullable<MountRecord['host']['edit']>>[0]) {
    const pending = mount.host.edit!(intent);
    await vi.advanceTimersByTimeAsync(300);
    return pending;
  }

  it('lets the next edit see the last one: a second kill of the same bet is refused, not repeated', async () => {
    const { mount } = await open();
    expect((await edit(mount, { kind: 'kill-activate-next', key: 'B-1' })).ok).toBe(true);
    const again = await edit(mount, { kind: 'kill-activate-next', key: 'B-1' });
    expect(again).toMatchObject({ ok: false, message: 'B-1 is already killed.' });
    const log = app.vault.text('Strategy/Bets/B-1 Get a D7 visa.md').match(/Killed\. Activating/g);
    expect(log).toHaveLength(1);
  });

  it('answers a log entry at once: it changes nothing the graph shows, so nothing is waited for', async () => {
    const { mount } = await open();
    const outcome = await mount.host.edit!({ kind: 'log', key: 'B-3', text: 'x' }); // no timers advanced
    expect(outcome.ok).toBe(true);
  });
  it('performs an edit through Obsidian, and the graph picks the change up from the cache', async () => {
    const { mount } = await open();
    const outcome = await edit(mount, { kind: 'set-status', key: 'B-3', status: 'dormant' });
    expect(outcome).toEqual({ ok: true, message: 'B-3 is now dormant.' });
    expect(app.vault.text(B3)).toContain('status: dormant');
    // The edit resolves once the graph has read the change, so the next one plans from it.
    expect(lastState(mount).graph!.nodes.find((n) => n.key === 'B-3')!.status).toBe('dormant');
  });

  it('writes a log line to the body through vault.process, leaving the frontmatter as it was', async () => {
    const { mount } = await open();
    const before = app.vault.text(B3);
    await mount.host.edit!({ kind: 'log', key: 'B-3', text: 'stall booked' });
    const after = app.vault.text(B3);
    expect(after.slice(0, after.indexOf('\n---\n') + 5)).toBe(before.slice(0, before.indexOf('\n---\n') + 5));
    expect(after).toContain('- 2026-10-01: stall booked');
    expect(app.vault.processed[app.vault.processed.length - 1].path).toBe(B3);
  });

  it('creates a note in its folder and links it, without opening it', async () => {
    const { mount } = await open();
    const outcome = await edit(mount, { kind: 'new-assumption', form: { statement: 'Stalls stay cheap', falsifier: '', verifyBy: '' }, dependents: ['B-3'] });
    expect(outcome.ok).toBe(true);
    expect(app.vault.text('Strategy/Assumptions/A-8 Stalls stay cheap.md')).toContain('id: A-8');
    expect(app.vault.text(B3)).toContain('[[A-8 Stalls stay cheap]]');
    expect(app.opened).toEqual([]);
  });

  it('says why when an edit is refused, and writes nothing', async () => {
    const { mount } = await open();
    const writes = app.vault.processed.length;
    const outcome = await mount.host.edit!({ kind: 'set-status', key: 'B-3', status: 'reached' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('not a status of a bet');
    expect(app.vault.processed.length).toBe(writes);
  });

  it('reports a failure part-way with what was already written', async () => {
    const { mount } = await open();
    app.vault.files.delete('Strategy/Bets/B-2 Apply for a digital nomad visa.md'); // the sequel's file vanishes under the plan
    const graph = lastState(mount).graph!; // still lists B-2
    expect(graph.nodes.some((n) => n.key === 'B-2')).toBe(true);
    const outcome = await mount.host.edit!({ kind: 'kill-activate-next', key: 'B-1' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Edit failed');
    expect(outcome.message).toContain('Nothing was changed');
  });

  it('reads a note for the inspector and renders its body without the frontmatter', async () => {
    const { mount } = await open();
    expect(await mount.host.readNote!(B3)).toContain('type: bet');
    const el = {} as HTMLElement;
    const cleanup = mount.host.renderNote!(el, B3);
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].sourcePath).toBe(B3);
    expect(rendered[0].markdown.startsWith('---')).toBe(false);
    expect(rendered[0].markdown).toContain('## The Bet');
    cleanup();
  });

  it('does not render into a note that was let go before it was read', async () => {
    const { mount } = await open();
    const cleanup = mount.host.renderNote!({} as HTMLElement, B3);
    cleanup(); // another note was selected before the file came back
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered).toHaveLength(0);
  });
});

describe('the free part of the map (Phase 7)', () => {
  it('writes a card edit into the .gsmap through vault.process after the quiet period, changing nothing else', async () => {
    const { mount } = await open();
    const before = app.vault.text(GSMAP_PATH);
    const cardsBefore = parseGsMap(before).ok ? (parseGsMap(before) as { map: { cards: unknown[] } }).map.cards.length : -1;
    expect(mount.host.editMap!({ op: 'put-card', card: { id: 'new', kind: 'text', text: 'idea', x: 1, y: 2, width: 250, height: 60 } })).toBe(true);
    expect(app.vault.text(GSMAP_PATH)).toBe(before);
    await vi.advanceTimersByTimeAsync(400);
    const read = parseGsMap(app.vault.text(GSMAP_PATH));
    if (!read.ok) throw new Error(read.error);
    expect(read.map.cards).toHaveLength(cardsBefore + 1);
    expect(read.map.positions).toEqual(positionsOn(before));
  });

  it('refuses card edits into a .gsmap it cannot read, and says so', async () => {
    app.vault.write(GSMAP_PATH, 'not json');
    const { mount } = await open();
    expect(mount.host.editMap!({ op: 'delete-card', id: 'x' })).toBe(false);
    expect(notices.map((n) => n.message).join('\n')).toContain("can't be read, so this change was not saved");
  });

  it('writes a pending card edit when the tab closes', async () => {
    const { mount, leaf } = await open();
    mount.host.editMap!({ op: 'delete-card', id: 'note' });
    await leaf.detach();
    const read = parseGsMap(app.vault.text(GSMAP_PATH));
    if (!read.ok) throw new Error(read.error);
    expect(read.map.cards.map((c) => c.id)).not.toContain('note');
  });
});

function positionsOn(text: string) {
  const read = parseGsMap(text);
  if (!read.ok) throw new Error(read.error);
  return read.map.positions;
}
