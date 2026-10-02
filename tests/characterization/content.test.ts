import { describe, expect, it } from 'vitest';
import { buildAssumptionContent, buildBetContent, buildMilestoneContent, buildRouteContent } from '../../src/core/content';

const BET_CASES: Record<string, any> = {
  'bet-minimal': {
    today: '2026-10-01',
    id: 'B-1',
    x: 'writing every morning',
    y: 'a finished draft',
    z: 'three months',
    deadline: '',
    servesBasenames: [],
    assumptionBasenames: [],
  },
  'bet-full': {
    today: '2026-10-01',
    id: 'B-9',
    x: 'saving from both incomes:',
    y: '20000 EUR saved :  ',
    z: 'ten months',
    deadline: '2027-08-01',
    servesBasenames: ['FP-2 Own a profitable ceramics studio', 'B-7  Part-time barista job'],
    ultimatelyServesBasenames: ['FP-1 Live in Portugal'],
    requiresBasenames: ['B-3 Sell pottery at weekend markets'],
    nextBasename: 'B-4 Save 20000 for kiln and lease',
    assumptionBasenames: ['A-8 New assumption', 'A-2 Rent in Lisbon stays under 1200'],
  },
  'bet-awkward-text': {
    today: '2026-10-01',
    id: 'B-10',
    x: 'mid: colon stays',
    y: 'He said "ação" \\ 🚀 — done',
    z: '',
    deadline: '2027-01-31',
    servesBasenames: ['FP-1 Live in Portugal'],
    assumptionBasenames: [],
  },
};

const ASSUMPTION_CASES: Record<string, any> = {
  'assumption-minimal': { today: '2026-10-01', id: 'A-1', statement: 'Tourists buy handmade ceramics.', falsifier: '', verifyBy: '' },
  'assumption-full': {
    today: '2026-10-01',
    id: 'A-12',
    statement: 'Workshops can fill eight seats.',
    falsifier: 'Fewer than four sign-ups after two months of ads.',
    verifyBy: '2026-12-15',
  },
};

const ROUTE_CASES: Record<string, any> = {
  'route-minimal': { today: '2026-10-01', id: 'R-1', ghost: false, description: '', servesBasenames: [] },
  'route-full': { today: '2026-10-01', id: 'R-2', ghost: false, description: 'Study in the US, then H1B.', servesBasenames: ['FP-1 Live in Portugal', 'B-4 Save 20000 for kiln and lease'] },
  'route-ghost': { today: '2026-10-01', id: 'R-3', ghost: true, description: '', servesBasenames: ['FP-2 Own a profitable ceramics studio'] },
};

const MILESTONE_CASES: Record<string, any> = {
  'milestone-minimal': { today: '2026-10-01', id: 'M-1', description: '', servesBasenames: [] },
  'milestone-full': { today: '2026-10-01', id: 'M-2', description: 'First paid workshop held.', servesBasenames: ['B-8 Teach pottery workshops'] },
};

describe('note content builders (schema v2)', () => {
  it.each(Object.keys(BET_CASES))('buildBetContent: %s', async (name) => {
    await expect(buildBetContent(BET_CASES[name])).toMatchFileSnapshot(`__golden__/content/${name}.md`);
  });

  it.each(Object.keys(ASSUMPTION_CASES))('buildAssumptionContent: %s', async (name) => {
    await expect(buildAssumptionContent(ASSUMPTION_CASES[name])).toMatchFileSnapshot(`__golden__/content/${name}.md`);
  });

  it.each(Object.keys(ROUTE_CASES))('buildRouteContent: %s', async (name) => {
    await expect(buildRouteContent(ROUTE_CASES[name])).toMatchFileSnapshot(`__golden__/content/${name}.md`);
  });

  it.each(Object.keys(MILESTONE_CASES))('buildMilestoneContent: %s', async (name) => {
    await expect(buildMilestoneContent(MILESTONE_CASES[name])).toMatchFileSnapshot(`__golden__/content/${name}.md`);
  });
});
