import { describe, expect, it } from 'vitest';
import { implementations } from '../support/impls';

const TITLES: unknown[] = [
  'Plain title',
  '  leading and trailing  ',
  'SaaS/PLG focus',
  'a#b[c]d^e|f/g\\h:i*j',
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

const SECTION_CASES: { name: string; content: string; heading: string; line: string; link: string }[] = [
  {
    name: 'already linked (bullet-less backlink counts)',
    content: '## Depended On By\n[[B-1 x]]\n',
    heading: '## Depended On By',
    line: '- [[B-1 x]]',
    link: '[[B-1 x]]',
  },
  {
    name: 'appends after placeholder and existing links, before next h2',
    content: '# T\n## Depended On By\n*placeholder*\n- [[B-1 a]]\n\n\n## Log\n- entry\n',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
  {
    name: 'empty section directly under heading',
    content: '## Depended On By\n\n## Log\n',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
  {
    name: 'h3 subsection stays inside the section',
    content: '## Depended On By\n- [[B-1 a]]\n### Notes\nsub text\n\n# Next h1\n',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
  {
    name: 'section is last in the file without trailing newline',
    content: 'intro\n## Depended On By\n- [[B-1 a]]',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
  {
    name: 'heading matched after trimming surrounding whitespace',
    content: '  ## Depended On By  \n- [[B-1 a]]\n',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
  {
    name: 'only the first matching heading is used',
    content: '## Depended On By\n- [[B-1 a]]\n## Log\n## Depended On By\n',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
  {
    name: 'missing section, content without newline',
    content: 'body text',
    heading: '## Assumptions This Bet Depends On',
    line: '- [[A-1 a]]',
    link: '[[A-1 a]]',
  },
  {
    name: 'missing section, content ending in one newline',
    content: 'body text\n',
    heading: '## Assumptions This Bet Depends On',
    line: '- [[A-1 a]]',
    link: '[[A-1 a]]',
  },
  {
    name: 'missing section, content ending in a blank line',
    content: 'body text\n\n',
    heading: '## Assumptions This Bet Depends On',
    line: '- [[A-1 a]]',
    link: '[[A-1 a]]',
  },
  {
    name: 'missing section, empty content',
    content: '',
    heading: '## Assumptions This Bet Depends On',
    line: '- [[A-1 a]]',
    link: '[[A-1 a]]',
  },
  {
    name: 'CRLF content',
    content: '## Depended On By\r\n- [[B-1 a]]\r\n\r\n## Log\r\n',
    heading: '## Depended On By',
    line: '- [[B-2 b]]',
    link: '[[B-2 b]]',
  },
];

const STRINGS: unknown[] = ['plain', 'with "quotes" and \\ backslash', 'line\nbreak\ttab', 'ação 🚀', '', null, undefined, 7];
const COLON_TEXTS: unknown[] = ['no colon', 'trailing:', 'trailing :  ', 'mid: colon', '::', '', null, undefined];

function snapshot(impl: (typeof implementations)[number]) {
  return {
    sanitizeTitle: TITLES.map((t) => [t ?? String(t), impl.sanitizeTitle(t)]),
    trimTrailingPunctuation: ['a.', 'a ,;', 'a - – —', 'a!?', '...', 'a.b'].map((t) => [t, impl.trimTrailingPunctuation(t)]),
    deriveAssumptionTitle: STATEMENTS.map((s) => [s ?? String(s), impl.deriveAssumptionTitle(s)]),
    deriveAssumptionTitleCustomLimit: [
      ['one two three four', 10],
      ['one two three four', 8],
      ['abcdefghijkl', 5],
    ].map(([s, n]) => [s, n, impl.deriveAssumptionTitle(s, n as number)]),
    parseIds: ID_SETS.map(({ basenames, prefix }) => {
      const r = impl.parseIds(basenames, prefix);
      return { basenames, prefix, ids: r.ids, used: Array.from(r.used), invalid: r.invalid, duplicates: r.duplicates, max: r.max };
    }),
    insertIntoSection: SECTION_CASES.map((c) => ({
      name: c.name,
      result: impl.insertIntoSection(c.content, c.heading, c.line, c.link),
    })),
    yamlString: STRINGS.map((s) => [s ?? String(s), impl.yamlString(s)]),
    stripTrailingColon: COLON_TEXTS.map((s) => [s ?? String(s), impl.stripTrailingColon(s)]),
  };
}

describe.each(implementations)('pure helpers ($name)', (impl) => {
  it('match the golden outputs', async () => {
    await expect(JSON.stringify(snapshot(impl), null, 2) + '\n').toMatchFileSnapshot('__golden__/pure.json');
  });
});
