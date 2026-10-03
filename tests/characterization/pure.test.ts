import { describe, expect, it } from 'vitest';
import { parseIds } from '../../src/core/ids';
import { deriveAssumptionTitle, sanitizeTitle, stripTrailingColon, trimTrailingPunctuation, yamlString } from '../../src/core/text';

const TITLES: unknown[] = [
  'Plain title',
  '  leading and trailing  ',
  'SaaS/PLG focus',
  'a#b[c]d^e|f/g\\h:i*j',
  'O1 visa? "Maybe" <later>',
  'tabs\tand\nnewlines\r\nhere',
  'control\u0000\u001f\u007fchars',
  'multiple     spaces',
  'ação — “smart quotes” 🚀',
  '###',
  '',
  null,
  undefined,
  42,
];

const STATEMENTS: unknown[] = [
  'Short statement.',
  'Ends with punctuation ...!?',
  'Ends with dashes – —',
  'A statement that is exactly sixty characters long, padding x',
  'A rather long statement that goes well beyond the sixty character budget for titles',
  'Averyveryverylongfirstwordthatexceedshalfthebudget and then more words follow it',
  'Short then Averyveryverylongsecondwordthatrunspastthebudgetlimitforsure',
  'Slash/separated:words*with#forbidden[chars] that also run past the limit, surely',
  '...',
  '###',
  '',
  null,
];

const ID_SETS: { basenames: string[]; prefix: string }[] = [
  { basenames: [], prefix: 'B' },
  { basenames: ['B-1 One', 'B-2 Two', 'B-10  byTalent backend engineer'], prefix: 'B' },
  { basenames: ['B-3 x', 'B-3 y', 'B-1 z', 'B-1 w', 'B-2'], prefix: 'B' },
  { basenames: ['FP-1 Fixed', 'A-1 Assumption', 'Current Position', 'b-4 lowercase', ' B-5 leading space'], prefix: 'B' },
  { basenames: ['B-007 Leading zeros', 'B-7 Seven'], prefix: 'B' },
  { basenames: ['B-99999999999999999999 Too big', 'B-1 ok'], prefix: 'B' },
  { basenames: ['A-1 one', 'A-12two', 'A-x nope', 'A- empty'], prefix: 'A' },
];

const STRINGS: unknown[] = ['plain', 'with "quotes" and \\ backslash', 'line\nbreak\ttab', 'ação 🚀', '', null, undefined, 7];
const COLON_TEXTS: unknown[] = ['no colon', 'trailing:', 'trailing :  ', 'mid: colon', '::', '', null, undefined];

function snapshot() {
  return {
    sanitizeTitle: TITLES.map((t) => [t ?? String(t), sanitizeTitle(t)]),
    trimTrailingPunctuation: ['a.', 'a ,;', 'a - – —', 'a!?', '...', 'a.b'].map((t) => [t, trimTrailingPunctuation(t)]),
    deriveAssumptionTitle: STATEMENTS.map((s) => [s ?? String(s), deriveAssumptionTitle(s)]),
    deriveAssumptionTitleCustomLimit: [
      ['one two three four', 10],
      ['one two three four', 8],
      ['abcdefghijkl', 5],
    ].map(([s, n]) => [s, n, deriveAssumptionTitle(s, n as number)]),
    parseIds: ID_SETS.map(({ basenames, prefix }) => {
      const r = parseIds(basenames, prefix);
      return { basenames, prefix, ids: r.ids, used: Array.from(r.used), invalid: r.invalid, duplicates: r.duplicates, max: r.max };
    }),
    yamlString: STRINGS.map((s) => [s ?? String(s), yamlString(s)]),
    stripTrailingColon: COLON_TEXTS.map((s) => [s ?? String(s), stripTrailingColon(s)]),
  };
}

describe('pure helpers', () => {
  it('match the golden outputs', async () => {
    await expect(JSON.stringify(snapshot(), null, 2) + '\n').toMatchFileSnapshot('__golden__/pure.json');
  });
});
