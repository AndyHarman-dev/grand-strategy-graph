import { describe, expect, it } from 'vitest';
import { naturalCompare, reviewWalk, type WalkStep } from '../../src/core/review-walk';
import { plannedTestVault } from '../../tools/test-vault';
import { graphOf, md, migratedTestVault } from '../support/v2';

describe('naturalCompare', () => {
  it('compares numbers inside names as numbers', () => {
    expect(['B-10', 'B-2', 'FP-1', 'B-1'].sort(naturalCompare)).toEqual(['B-1', 'B-2', 'B-10', 'FP-1']);
  });
});

/** `M-1.md` with that frontmatter; links are by basename, so `[[B-1]]` finds `Strategy/B-1.md`. */
const note = (id: string, type: string, fm: Record<string, unknown> = {}): [string, string] => [`Strategy/${id}.md`, md({ id, type, ...fm })];
const vault = (...notes: [string, string][]) => Object.fromEntries(notes);
const CP = note('CP', 'current-position');
/** A note's id from its key, for the vaults made with `note`. */
const idOf = (key: string) => key.replace(/^Strategy\/|\.md$/g, '');
const ids = (steps: WalkStep[]) => steps.map((s) => idOf(s.node));

describe('reviewWalk', () => {
  it('walks each route from the fixed point back to the current position before the next route starts', async () => {
    // C → B-1 → B-2 → F-1 and C → B-4 → B-5 → M-1 → F-1 (C, the current position, is where both start).
    const steps = reviewWalk(await graphOf(vault(
      CP,
      note('F-1', 'fixed-point'),
      note('B-1', 'bet', { serves: '[[B-2]]' }),
      note('B-2', 'bet', { serves: '[[F-1]]' }),
      note('B-4', 'bet', { serves: '[[B-5]]' }),
      note('B-5', 'bet', { serves: '[[M-1]]' }),
      note('M-1', 'milestone', { status: 'open', serves: '[[F-1]]' }),
    )));
    expect(ids(steps)).toEqual(['F-1', 'B-2', 'B-1', 'CP', 'M-1', 'B-5', 'B-4', 'CP']);
    expect(steps.map((s) => `${s.group} ${s.route}/${s.routes} ${s.depth}/${s.routeLength}`)).toEqual([
      'fixed-point 0/2 0/0',
      'route 1/2 1/3', 'route 1/2 2/3', 'current-position 1/2 3/3',
      'route 2/2 1/4', 'route 2/2 2/4', 'route 2/2 3/4', 'current-position 2/2 4/4',
    ]);
    expect(steps[6].via.map(idOf)).toEqual(['B-4', 'B-5', 'M-1', 'F-1']);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it('takes the branches of a fork by id, and shows the fork once', async () => {
    const steps = reviewWalk(await graphOf(vault(
      CP,
      note('F-1', 'fixed-point'),
      note('M-1', 'milestone', { status: 'open', serves: '[[F-1]]' }),
      note('B-6', 'bet', { serves: '[[M-1]]' }),
      note('B-5', 'bet', { serves: '[[M-1]]' }),
      note('B-4', 'bet', { serves: '[[B-5]]' }),
    )));
    expect(ids(steps)).toEqual(['F-1', 'M-1', 'B-5', 'B-4', 'CP', 'B-6', 'CP']);
    expect(steps.map((s) => s.route)).toEqual([0, 1, 1, 1, 1, 2, 2]);
  });

  it('walks a note on two routes on each, with what is behind it, and under each fixed point it leads to', async () => {
    const steps = reviewWalk(await graphOf(vault(
      note('F-1', 'fixed-point'),
      note('F-2', 'fixed-point'),
      note('B-1', 'bet', { serves: '[[B-2]]' }),
      note('B-2', 'bet', { serves: ['[[B-3]]', '[[B-4]]', '[[F-2]]'] }),
      note('B-3', 'bet', { serves: '[[F-1]]' }),
      note('B-4', 'bet', { serves: '[[F-1]]' }),
    )));
    // No current position in this vault: a route ends on its first note.
    expect(ids(steps)).toEqual(['F-1', 'B-3', 'B-2', 'B-1', 'B-4', 'B-2', 'B-1', 'F-2', 'B-2', 'B-1']);
    expect(steps.map((s) => idOf(s.fixedPoint))).toEqual(['F-1', 'F-1', 'F-1', 'F-1', 'F-1', 'F-1', 'F-1', 'F-2', 'F-2', 'F-2']);
  });

  it('goes through a milestone to the bets that start from it, and follows a requires whose serves is missing', async () => {
    // M-1 → B-2 → M-2 → F-1: the bets between two milestones (D17). B-1 is only in M-1's requires.
    const steps = reviewWalk(await graphOf(vault(
      CP,
      note('F-1', 'fixed-point'),
      note('M-2', 'milestone', { status: 'open', serves: '[[F-1]]' }),
      note('B-2', 'bet', { serves: '[[M-2]]' }),
      note('M-1', 'milestone', { status: 'reached', serves: '[[B-2]]', requires: '[[B-1]]' }),
      note('B-1', 'bet'),
    )));
    expect(ids(steps)).toEqual(['F-1', 'M-2', 'B-2', 'M-1', 'B-1', 'CP']);
  });

  it('leaves out bets and milestones on no route, and stops a serves loop where it closes', async () => {
    const steps = reviewWalk(await graphOf(vault(
      CP,
      note('F-1', 'fixed-point'),
      note('B-1', 'bet', { serves: ['[[F-1]]', '[[B-2]]'] }),
      note('B-2', 'bet', { serves: '[[B-1]]' }),
      note('B-9', 'bet'),
      note('M-9', 'milestone', { status: 'open' }),
    )));
    expect(ids(steps)).toEqual(['F-1', 'B-1', 'B-2', 'CP']);
  });

  it('shows a fixed point nothing leads to as a step of its own, and walks nothing without a fixed point', async () => {
    const steps = reviewWalk(await graphOf(vault(CP, note('F-1', 'fixed-point'), note('B-1', 'bet'))));
    expect(steps).toMatchObject([{ group: 'fixed-point', route: 0, routes: 0 }]);
    expect(reviewWalk(await graphOf(vault(CP, note('B-1', 'bet'))))).toEqual([]);
    expect(reviewWalk(await graphOf({}))).toEqual([]);
  });

  it('over the test vault: each fixed point by id, each route to its end, the assumptions with their note', async () => {
    const graph = await graphOf(migratedTestVault());
    const idIn = (key: string) => graph.nodes.find((n) => n.key === key)!.id;
    const steps = reviewWalk(graph);
    // B-4 requires B-3 and B-5 and both serve it; B-7 serves nothing, so it is on no route.
    expect(steps.map((s) => idIn(s.node))).toEqual([
      'FP-1', 'B-1', 'CP', 'B-2', 'CP', 'B-5', 'CP',
      'FP-2', 'B-4', 'B-3', 'CP', 'B-5', 'CP', 'B-8', 'CP', 'B-6', 'CP',
    ]);
    expect(steps[9]).toMatchObject({ group: 'route', depth: 2, route: 1, routes: 4, routeLength: 3 });
    expect(steps[9].via.map(idIn)).toEqual(['B-3', 'B-4', 'FP-2']);
    expect(steps[0].assumptions.map(idIn)).toEqual(['A-6']);
    expect(steps[9].assumptions.map(idIn)).toEqual(['A-3', 'A-4']);
  });

  it('over the planner\'s migrated test vault: B-7 serves B-4, and B-6 (whose link is the phantom note, D13) is on no route', async () => {
    const graph = await graphOf(plannedTestVault());
    const steps = reviewWalk(graph).filter((s) => s.group !== 'current-position');
    expect(steps.map((s) => graph.nodes.find((n) => n.key === s.node)!.id)).toEqual(['FP-1', 'B-1', 'B-2', 'B-5', 'FP-2', 'B-4', 'B-3', 'B-5', 'B-7', 'B-8']);
  });
});
