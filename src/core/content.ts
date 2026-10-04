import { DEPENDED_ON_BY_HEADING, STRATEGY_FOLDER } from './constants';
import { stripTrailingColon, yamlString } from './text';

/**
 * Note bodies and frontmatter in schema v2, matching what Phase 2's migration produces from
 * the legacy notes and what the migrated `Templates/` hold: every relationship lives in the
 * frontmatter (D2), so no body section lists links.
 */

/** The live replacement for `## Depended On By`: dependents computed from frontmatter (D2). */
export function dependedOnByBlock(root: string = STRATEGY_FOLDER): string[] {
  return ['```dataview', 'LIST', `FROM "${root}"`, 'WHERE contains(assumptions, this.file.link)', 'SORT file.name ASC', '```'];
}

/** A list field: `key:` alone when empty, else one quoted wikilink per line. */
function linkList(key: string, basenames: readonly string[]): string[] {
  if (!basenames.length) return [key + ':'];
  return [key + ':', ...basenames.map((b) => '  - ' + yamlString('[[' + b + ']]'))];
}

/** The section of an assumption that says what would falsify it. */
export const FALSIFIER_HEADING = "## How I'd Know It's False";
export const FALSIFIER_PLACEHOLDER = "*What observable evidence would falsify this? If nothing could, it's a belief, not an assumption — rewrite it.*";

export interface AssumptionContentOptions {
  today: string;
  /** `A-<n>`. */
  id: string;
  statement: string;
  falsifier: string;
  verifyBy: string;
}

/** Assumption note, mirroring Templates/Assumption Template.md. Dependents point at it from their own `assumptions`. */
export function buildAssumptionContent(opts: AssumptionContentOptions): string {
  const frontmatter = [
    '---',
    'id: ' + opts.id,
    'type: assumption',
    'status: unverified',
    'created: ' + opts.today,
    'verify-by:' + (opts.verifyBy ? ' ' + opts.verifyBy : ''),
    '---',
  ];

  const body = [
    '## The Assumption',
    opts.statement,
    '',
    FALSIFIER_HEADING,
    opts.falsifier ? opts.falsifier : FALSIFIER_PLACEHOLDER,
    '',
    '## Verify By',
    '*If this assumption is load-bearing, set a date in the frontmatter by which I should have evidence either way. This is the anti-postponement discipline: name the information and the deadline.*',
    '',
    DEPENDED_ON_BY_HEADING,
    ...dependedOnByBlock(),
    '',
    '## Log',
    '- ' + opts.today + ': Created',
    '',
  ];

  return frontmatter.concat(body).join('\n');
}

export interface BetContentOptions {
  today: string;
  /** `B-<n>`. */
  id: string;
  x: string;
  y: string;
  z: string;
  deadline: string;
  servesBasenames: string[];
  ultimatelyServesBasenames?: string[];
  requiresBasenames?: string[];
  /** The sequel activated when this bet is killed. */
  nextBasename?: string | null;
  assumptionBasenames: string[];
}

/** Bet note, mirroring Templates/Bet Template.md. */
export function buildBetContent(opts: BetContentOptions): string {
  const frontmatter = ['---', 'id: ' + opts.id, 'type: bet', 'status: active', 'started: ' + opts.today];
  frontmatter.push('deadline:' + (opts.deadline ? ' ' + opts.deadline : ''));
  frontmatter.push('expected-result: ' + yamlString(opts.y));
  frontmatter.push(...linkList('serves', opts.servesBasenames));
  // Optional: the template omits it, so a note only carries the key when it has a far anchor.
  if (opts.ultimatelyServesBasenames?.length) frontmatter.push(...linkList('ultimately-serves', opts.ultimatelyServesBasenames));
  frontmatter.push(...linkList('requires', opts.requiresBasenames ?? []));
  frontmatter.push('next:' + (opts.nextBasename ? ' ' + yamlString('[[' + opts.nextBasename + ']]') : ''));
  frontmatter.push(...linkList('assumptions', opts.assumptionBasenames));
  frontmatter.push('---');

  const body = [
    '## The Bet',
    'I believe continuing **' + stripTrailingColon(opts.x) + ':** `[action/effort]`',
    'will produce **' + stripTrailingColon(opts.y) + ':** `[concrete, observable result]`',
    'within **' + stripTrailingColon(opts.z) + ':** `[timeframe — must match the deadline above]`',
    '',
    '## Kill Condition (decided NOW, before the deadline)',
    'When the deadline arrives and Y has not materialized, this bet is:',
    '- [ ] **Killed** — X stops entirely',
    '- [ ] **Modified** — X changes to: ',
    '- [ ] **Extended once** — new deadline: `____` — written justification required below',
    '',
    '> Extension justification (fill only if extending; one extension maximum):',
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
    '',
  ];

  return frontmatter.concat(body).join('\n');
}

export interface MilestoneContentOptions {
  today: string;
  /** `M-<n>`. */
  id: string;
  description: string;
  servesBasenames: string[];
}

/** Milestone note: a checkpoint (D17), `open` until it is reached. Bets that start from it list it in `requires`. */
export function buildMilestoneContent(opts: MilestoneContentOptions): string {
  const frontmatter = ['---', 'id: ' + opts.id, 'type: milestone', 'status: open'];
  frontmatter.push(...linkList('serves', opts.servesBasenames), ...linkList('assumptions', []), '---');
  const body = [
    '## The Milestone',
    opts.description || '*What will be true when this milestone is reached? Set `status: reached` then: the bets that require it can start.*',
    '',
    '## Log',
    '- ' + opts.today + ': Created',
    '',
  ];
  return frontmatter.concat(body).join('\n');
}
