import { MemoryAdapter } from '../../src/core/memory-adapter';
import { buildGraph } from '../../src/core/graph';

/** A markdown note whose frontmatter is written as YAML flow values (JSON is valid YAML). */
export function md(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => (v === null ? `${k}:` : `${k}: ${JSON.stringify(v)}`));
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

const link = (name: string) => `[[${name}]]`;

/**
 * The synthetic test vault in schema v2 (canonical statuses, relations in frontmatter),
 * hand-written for the smell tests. `tests/migration/test-vault.test.ts` checks that the
 * Phase 2 planner builds the same graph from the legacy vault, except one deliberate
 * difference: here B-6 serves the real FP-2, while the planner keeps B-6's link to the
 * phantom root note as it is (D13).
 */
export function migratedTestVault(): Record<string, string> {
  const fp1 = 'FP-1 Live in Portugal';
  const fp2 = 'FP-2 Own a profitable ceramics studio';
  const b = (id: number, title: string) => `B-${id} ${title}`;
  const a = (id: number, title: string) => `A-${id} ${title}`;
  const bet = (id: number, title: string, fm: Record<string, unknown>): [string, string] => [
    `Strategy/Bets/${b(id, title)}.md`,
    md({ id: `B-${id}`, type: 'bet', ...fm }),
  ];
  const assumption = (id: number, title: string, fm: Record<string, unknown>): [string, string] => [
    `Strategy/Assumptions/${a(id, title)}.md`,
    md({ id: `A-${id}`, type: 'assumption', ...fm }),
  ];
  const entries: [string, string][] = [
    bet(1, 'Get a D7 visa', {
      status: 'active', deadline: '2026-12-01', serves: [link(fp1)], next: link(b(2, 'Apply for a digital nomad visa')),
      assumptions: [link(a(1, 'D7 accepts freelance income')), link(a(2, 'Rent in Lisbon stays under 1200'))],
    }),
    bet(2, 'Apply for a digital nomad visa', { status: 'dormant', deadline: null, serves: [link(fp1)] }),
    bet(3, 'Sell pottery at weekend markets', {
      status: 'active', deadline: '2026-10-15', serves: [link(b(4, 'Save 20000 for kiln and lease'))],
      assumptions: [link(a(3, 'Weekend market stalls are available')), link(a(4, 'Tourists buy handmade ceramics'))],
    }),
    bet(4, 'Save 20000 for kiln and lease', {
      status: 'active', deadline: '2027-06-01', serves: [link(fp2)],
      requires: [link(b(3, 'Sell pottery at weekend markets')), link(b(5, 'Learn Portuguese to B1'))],
      assumptions: [link(a(2, 'Rent in Lisbon stays under 1200'))],
    }),
    bet(5, 'Learn Portuguese to B1', { status: 'won', deadline: '2026-09-10', serves: [link(fp1)], assumptions: [link(a(5, 'I can study one hour a day'))] }),
    bet(6, 'Online ceramics course', { status: 'killed', deadline: '2026-08-01', serves: [link(fp2)] }),
    bet(7, 'Part-time barista job', { status: 'active', deadline: null }),
    bet(8, 'Teach pottery workshops', { status: 'dormant', deadline: null, serves: [link(b(4, 'Save 20000 for kiln and lease'))], assumptions: [link(a(7, 'Workshops can fill eight seats'))] }),
    assumption(1, 'D7 accepts freelance income', { status: 'confirmed', created: '2026-07-05T10:00:00', 'verify-by': '2026-07-20T18:00:00' }),
    assumption(2, 'Rent in Lisbon stays under 1200', { status: 'unverified', created: '2026-07-05', 'verify-by': null }),
    assumption(3, 'Weekend market stalls are available', { status: 'falsified', created: '2026-08-01', 'verify-by': '2026-08-10' }),
    assumption(4, 'Tourists buy handmade ceramics', { status: 'undeterminable', created: '2026-08-01', 'verify-by': null }),
    assumption(5, 'I can study one hour a day', { status: 'unverified', created: '2026-07-10', 'verify-by': '2026-10-01T09:00:00' }),
    assumption(6, 'Portugal stays open to non-EU residents', { status: 'unverified', created: '2026-07-01', 'verify-by': null }),
    assumption(7, 'Workshops can fill eight seats', { status: 'unverified', created: '2026-08-20', 'verify-by': '2026-11-01' }),
    [`Strategy/Fixed Points/${fp1}.md`, md({ id: 'FP-1', type: 'fixed-point', assumptions: [link(a(6, 'Portugal stays open to non-EU residents'))] })],
    [`Strategy/Fixed Points/${fp2}.md`, md({ id: 'FP-2', type: 'fixed-point' })],
    ['Strategy/Current Position.md', md({ id: 'CP', type: 'current-position' })],
    ['lisbon-neighbourhoods-research.md', md({ categories: [link('Research')] })],
  ];
  return Object.fromEntries(entries);
}

/** Build a graph from path → markdown (default root: Strategy/). */
export async function graphOf(files: Record<string, string>) {
  return buildGraph(await new MemoryAdapter(files).readNotes());
}
