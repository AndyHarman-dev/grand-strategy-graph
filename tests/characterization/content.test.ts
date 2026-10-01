import { describe, expect, it } from 'vitest';
import { implementations } from '../support/impls';

const BET_CASES: Record<string, any> = {
  'bet-minimal': {
    today: '2026-10-01',
    x: 'writing every morning',
    y: 'a finished draft',
    z: 'three months',
    deadline: '',
    servesBasenames: [],
    assumptionLinks: [],
  },
  'bet-full': {
    today: '2026-10-01',
    x: 'saving from both incomes:',
    y: '20000 EUR saved :  ',
    z: 'ten months',
    deadline: '2027-08-01',
    servesBasenames: ['FP-2 Own a profitable ceramics studio', 'B-7  Part-time barista job'],
    assumptionLinks: ['[[A-8 New assumption]]', '[[A-2 Rent in Lisbon stays under 1200]]'],
  },
  'bet-awkward-text': {
    today: '2026-10-01',
    x: 'mid: colon stays',
    y: 'He said "ação" \\ 🚀 — done',
    z: '',
    deadline: '2027-01-31',
    servesBasenames: ['FP-1 Live in Portugal'],
    assumptionLinks: [],
  },
};

const ASSUMPTION_CASES: Record<string, any> = {
  'assumption-minimal': {
    today: '2026-10-01',
    statement: 'Tourists buy handmade ceramics.',
    falsifier: '',
    verifyBy: '',
    betLinks: [],
  },
  'assumption-full': {
    today: '2026-10-01',
    statement: 'Workshops can fill eight seats.',
    falsifier: 'Fewer than four sign-ups after two months of ads.',
    verifyBy: '2026-12-15',
    betLinks: ['[[B-8 Teach pottery workshops]]'],
  },
  'assumption-many-bets': {
    today: '2026-10-01',
    statement: 'Rent stays low',
    falsifier: 'Listings rise',
    verifyBy: '',
    betLinks: ['[[B-3 Sell pottery at weekend markets]]', '[[B-7  Part-time barista job]]', '[[B-4 Save 20000 for kiln and lease]]'],
  },
  'assumption-single-betLink-fallback': {
    today: '2026-10-01',
    statement: 'Legacy single-link call shape',
    falsifier: '',
    verifyBy: '',
    betLink: '[[B-1 Get a D7 visa]]',
  },
  'assumption-no-links-at-all': {
    today: '2026-10-01',
    statement: 'Nobody depends on this yet',
    falsifier: 'x',
    verifyBy: '2026-11-01',
  },
};

describe.each(implementations)('note content builders ($name)', (impl) => {
  it.each(Object.keys(BET_CASES))('buildBetContent: %s', async (name) => {
    await expect(impl.buildBetContent(BET_CASES[name])).toMatchFileSnapshot(`__golden__/content/${name}.md`);
  });

  it.each(Object.keys(ASSUMPTION_CASES))('buildAssumptionContent: %s', async (name) => {
    await expect(impl.buildAssumptionContent(ASSUMPTION_CASES[name])).toMatchFileSnapshot(
      `__golden__/content/${name}.md`
    );
  });
});
