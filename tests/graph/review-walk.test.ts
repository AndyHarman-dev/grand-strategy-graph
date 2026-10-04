import { describe, expect, it } from 'vitest';
import { naturalCompare, reviewWalk } from '../../src/core/review-walk';
import { plannedTestVault } from '../../tools/test-vault';
import { graphOf, md, migratedTestVault } from '../support/v2';

describe('naturalCompare', () => {
  it('compares numbers inside names as numbers', () => {
    expect(['B-10', 'B-2', 'FP-1', 'B-1'].sort(naturalCompare)).toEqual(['B-1', 'B-2', 'B-10', 'FP-1']);
  });
});

describe('reviewWalk', () => {
  it('goes through each fixed point, then outward along the serves chains, nearest first', async () => {
    const steps = reviewWalk(await graphOf(migratedTestVault()));
    expect(steps.map((s) => `${s.group}:${s.node}@${s.depth}`)).toEqual([
      'fixed-point:FP-1@0',
      'route:B-1@1',
      'route:B-2@1',
      'route:B-5@1',
      'fixed-point:FP-2@0',
      'route:B-4@1',
      'route:B-6@1',
      'route:B-3@2',
      'route:B-8@2',
      'unrouted:B-7@0',
    ]);
  });

  it('over the planner\'s migrated test vault: B-7 serves B-4, and B-6 (whose link is the phantom note, D13) is on no route', async () => {
    const steps = reviewWalk(await graphOf(plannedTestVault()));
    expect(steps.map((s) => s.node)).toEqual(['FP-1', 'B-1', 'B-2', 'B-5', 'FP-2', 'B-4', 'B-3', 'B-7', 'B-8', 'B-6']);
    expect(steps[steps.length - 1]).toMatchObject({ group: 'unrouted' });
  });

  it('says how each note reaches its fixed point, and which assumptions it leans on', async () => {
    const steps = Object.fromEntries(reviewWalk(await graphOf(migratedTestVault())).map((s) => [s.node, s]));
    expect(steps['B-3']).toMatchObject({ fixedPoint: 'FP-2', depth: 2, via: ['B-3', 'B-4', 'FP-2'], assumptions: ['A-3', 'A-4'] });
    expect(steps['FP-1']).toMatchObject({ fixedPoint: null, via: ['FP-1'], assumptions: ['A-6'] });
    expect(steps['B-7']).toMatchObject({ group: 'unrouted', fixedPoint: null, via: ['B-7'] });
  });

  it('visits a note two fixed points share once, under the first, and handles a serves loop', async () => {
    const files = {
      'Strategy/FP-1 One.md': md({ id: 'FP-1', type: 'fixed-point' }),
      'Strategy/FP-2 Two.md': md({ id: 'FP-2', type: 'fixed-point' }),
      'Strategy/B-1 Shared.md': md({ id: 'B-1', type: 'bet', status: 'active', serves: ['[[FP-1 One]]', '[[FP-2 Two]]', '[[B-2 Loop]]'] }),
      'Strategy/B-2 Loop.md': md({ id: 'B-2', type: 'bet', status: 'active', serves: ['[[B-1 Shared]]'] }),
    };
    const steps = reviewWalk(await graphOf(files));
    expect(steps.map((s) => `${s.node}<${s.fixedPoint}`)).toEqual(['FP-1<null', 'B-1<FP-1', 'B-2<FP-1', 'FP-2<null']);
  });

  it('walks a vault with no fixed point as unrouted notes, and an empty one as nothing', async () => {
    const steps = reviewWalk(await graphOf({ 'Strategy/B-2.md': md({ id: 'B-2', type: 'bet' }), 'Strategy/B-10.md': md({ id: 'B-10', type: 'bet' }) }));
    expect(steps.map((s) => s.node)).toEqual(['B-2', 'B-10']);
    expect(reviewWalk(await graphOf({}))).toEqual([]);
  });
});
