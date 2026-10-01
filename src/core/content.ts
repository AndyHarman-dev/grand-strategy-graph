import { DEPENDED_ON_BY_HEADING } from './constants';
import { stripTrailingColon, yamlString } from './text';

export interface AssumptionContentOptions {
  today: string;
  statement: string;
  falsifier: string;
  verifyBy: string;
  /** Zero or more `[[Bet]]` links. Takes precedence over `betLink`. */
  betLinks?: string[];
  /** Single-link call shape, used when `betLinks` is absent. */
  betLink?: string;
}

/**
 * Assumption note body, mirroring Templates/Assumption Template.md.
 * `betLinks` (zero or more `[[Bet]]` strings) covers both call sites: a bet's
 * own new-assumption rows pass exactly one (the bet being created), while
 * standalone assumption creation passes however many existing bets were
 * picked, including none.
 */
export function buildAssumptionContent(opts: AssumptionContentOptions): string {
  const frontmatter = [
    '---',
    'type: assumption',
    'status: unverified',
    'created: ' + opts.today,
    'verify-by:' + (opts.verifyBy ? ' ' + opts.verifyBy : ''),
    '---',
  ];

  const betLinks = opts.betLinks || (opts.betLink ? [opts.betLink] : []);

  const body = [
    '## The Assumption',
    opts.statement,
    '',
    "## How I'd Know It's False",
    opts.falsifier
      ? opts.falsifier
      : "*What observable evidence would falsify this? If nothing could, it's a belief, not an assumption — rewrite it.*",
    '',
    '## Verify By',
    '*If this assumption is load-bearing, set a date in the frontmatter by which I should have evidence either way. This is the anti-postponement discipline: name the information and the deadline.*',
    '',
    DEPENDED_ON_BY_HEADING,
    '*Check linked mentions — every bet and decision that leans on this. When status flips to `falsified`, everything listed there needs re-examination at the next weekly review.*',
  ];
  for (const link of betLinks) {
    body.push('- ' + link);
  }
  body.push('', '## Log', '- ' + opts.today + ': Created', '');

  return frontmatter.concat(body).join('\n');
}

export interface BetContentOptions {
  today: string;
  x: string;
  y: string;
  z: string;
  deadline: string;
  servesBasenames: string[];
  assumptionLinks: string[];
}

/** Bet note body, mirroring Templates/Bet Template.md. */
export function buildBetContent(opts: BetContentOptions): string {
  const frontmatter = ['---', 'type: bet', 'status: active', 'started: ' + opts.today];
  frontmatter.push('deadline:' + (opts.deadline ? ' ' + opts.deadline : ''));
  frontmatter.push('expected-result: ' + yamlString(opts.y));
  if (opts.servesBasenames.length) {
    frontmatter.push('serves:');
    for (const basename of opts.servesBasenames) {
      frontmatter.push('  - ' + yamlString('[[' + basename + ']]'));
    }
  } else {
    frontmatter.push('serves:');
  }
  frontmatter.push('next sequel:');
  frontmatter.push('---');

  const body = [
    '## The Bet',
    'I believe continuing **' + stripTrailingColon(opts.x) + ':** `[action/effort]`',
    'will produce **' + stripTrailingColon(opts.y) + ':** `[concrete, observable result]`',
    'within **' + stripTrailingColon(opts.z) + ':** `[timeframe — must match the deadline above]`',
    '',
    '## Serves',
    'Which fixed point / direction does this bet serve?',
  ];
  for (const basename of opts.servesBasenames) {
    body.push('- [[' + basename + ']]');
  }
  body.push(
    '',
    '## Kill Condition (decided NOW, before the deadline)',
    'When the deadline arrives and Y has not materialized, this bet is:',
    '- [ ] **Killed** — X stops entirely',
    '- [ ] **Modified** — X changes to: ',
    '- [ ] **Extended once** — new deadline: `____` — written justification required below',
    '',
    '> Extension justification (fill only if extending; one extension maximum):',
    '',
    '## Assumptions This Bet Depends On'
  );
  for (const link of opts.assumptionLinks) {
    body.push('- ' + link);
  }
  body.push(
    '',
    '## Log',
    '*Weekly check-ins go here. Date + one line: on track / off track / signal observed.*',
    '',
    '- ' + opts.today + ': created',
    '',
    '## Resolution',
    '*Fill when the bet closes.*',
    '- **Outcome:** ',
    '- **What I learned:** ',
    '- **Status updated in frontmatter?** (active → won / killed / extended)',
    ''
  );

  return frontmatter.concat(body).join('\n');
}
