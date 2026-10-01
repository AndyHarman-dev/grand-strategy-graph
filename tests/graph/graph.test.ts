import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/core/graph';
import type { NoteRecord } from '../../src/core/schema';
import { FsAdapter } from '../../tools/fs-adapter';
import { TEST_VAULT_DIR } from '../support/fake-app';
import { graphOf, migratedTestVault } from '../support/v2';

const summary = (g: Awaited<ReturnType<typeof graphOf>>) => ({
  edges: g.edges.map((e) => `${e.kind} ${e.from}>${e.to}`).sort(),
  issues: g.issues.map((i) => `${i.code} ${i.path.split('/').pop()}${i.field ? ' ' + i.field : ''}`).sort(),
});

describe('buildGraph over the migrated test vault (schema v2)', () => {
  it('builds every strategy node and no issues', async () => {
    const graph = await graphOf(migratedTestVault());
    expect(graph.issues).toEqual([]);
    expect(graph.nodes.map((n) => n.key).sort()).toEqual([
      'A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'CP', 'FP-1', 'FP-2',
    ]);
    expect(graph.nodes.find((n) => n.key === 'B-7')?.basename).toBe('B-7 Part-time barista job');
  });

  it('derives every edge kind from the field and checks the target type', async () => {
    const { edges } = await graphOf(migratedTestVault());
    expect(edges.filter((e) => e.kind === 'serves').map((e) => `${e.from}>${e.to}`).sort()).toEqual([
      'B-1>FP-1', 'B-2>FP-1', 'B-3>B-4', 'B-4>FP-2', 'B-5>FP-1', 'B-6>FP-2', 'B-8>B-4',
    ]);
    expect(edges.filter((e) => e.kind === 'next').map((e) => `${e.from}>${e.to}`)).toEqual(['B-1>B-2']);
    expect(edges.filter((e) => e.kind === 'requires').map((e) => `${e.from}>${e.to}`).sort()).toEqual(['B-4>B-3', 'B-4>B-5']);
    expect(edges.filter((e) => e.kind === 'assumption').map((e) => `${e.from}>${e.to}`).sort()).toEqual([
      'B-1>A-1', 'B-1>A-2', 'B-3>A-3', 'B-3>A-4', 'B-4>A-2', 'B-5>A-5', 'B-8>A-7', 'FP-1>A-6',
    ]);
    const fixedPointAssumption = edges.find((e) => e.from === 'FP-1' && e.to === 'A-6');
    expect(fixedPointAssumption).toMatchObject({ fromType: 'fixed-point', toType: 'assumption', field: 'assumptions' });
  });

  it('is independent of note order', async () => {
    const files = migratedTestVault();
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    expect(await graphOf(reversed)).toEqual(await graphOf(files));
  });
});

describe('buildGraph over the legacy test vault (pre-migration)', () => {
  it('reports every legacy anomaly as an issue, never throws', async () => {
    const graph = buildGraph(await new FsAdapter(TEST_VAULT_DIR).readNotes());
    const { issues } = summary(graph);

    // Legacy notes have no `id`, so nodes are keyed by path. Only frontmatter `serves` links
    // that resolve to a typed note become edges; `next sequel` is not a v2 field.
    const name = (key: string) => key.replace(/^.*\//, '').replace(/\.md$/, '').split(' ')[0];
    expect(graph.edges.map((e) => `${e.kind} ${name(e.from)}>${name(e.to)}`).sort()).toEqual([
      'serves B-1>FP-1', 'serves B-2>FP-1', 'serves B-3>B-4', 'serves B-4>FP-2', 'serves B-5>FP-1', 'serves B-8>B-4',
    ]);

    expect(graph.nodes).toHaveLength(17); // 8 bets, 7 assumptions, 2 fixed points; Current Position has no type yet
    expect(issues.filter((i) => i.startsWith('missing-id'))).toHaveLength(17);
    expect(issues.filter((i) => i.startsWith('unknown-status'))).toEqual([
      'unknown-status B-2 Apply for a digital nomad visa.md status',
      'unknown-status B-6 Online ceramics course.md status',
      'unknown-status B-8 Teach pottery workshops.md status',
    ]);
    expect(issues).toContain('self-link B-5 Learn Portuguese to B1.md serves'); // self-loop
    expect(issues).toContain('dangling-link B-7  Part-time barista job.md serves'); // [[...]]
    expect(issues).toContain('non-strategy-target B-6 Online ceramics course.md serves'); // phantom root FP-2
  });
});

describe('buildGraph issues', () => {
  const note = (path: string, frontmatter: Record<string, unknown>, resolvedLinks: Record<string, string | null> = {}): NoteRecord => ({
    path, basename: path.replace(/^.*\//, '').replace(/\.md$/, ''), frontmatter, resolvedLinks,
  });
  const bet = (name: string, fm: Record<string, unknown> = {}, links: Record<string, string | null> = {}) =>
    note(`Strategy/${name}.md`, { id: name, type: 'bet', status: 'active', ...fm }, links);
  const codes = (notes: NoteRecord[]) => buildGraph(notes).issues.map((i) => i.code);

  it('skips notes without a type and flags unknown types', () => {
    expect(codes([note('x.md', { title: 'plain' })])).toEqual([]);
    expect(codes([note('x.md', { type: 'meeting' })])).toEqual(['unknown-type']);
  });

  it('flags a missing or unknown status, but not types without statuses', () => {
    expect(codes([bet('B-1', { status: undefined })])).toEqual(['missing-status']);
    expect(codes([bet('B-1', { status: 'asleep' })])).toEqual(['unknown-status']);
    expect(codes([note('Strategy/F.md', { id: 'FP-1', type: 'fixed-point' })])).toEqual([]);
    expect(codes([note('Strategy/R.md', { id: 'R-1', type: 'route', status: 'ghost' })])).toEqual([]);
  });

  it('flags missing and duplicate ids, keying the node by path then', () => {
    const graph = buildGraph([bet('B-1', { id: undefined }), bet('B-2', { id: 'X' }), bet('B-3', { id: 'X' })]);
    expect(graph.issues.map((i) => i.code).sort()).toEqual(['duplicate-id', 'duplicate-id', 'missing-id']);
    expect(graph.nodes.map((n) => n.key).sort()).toEqual(['Strategy/B-1.md', 'Strategy/B-2.md', 'Strategy/B-3.md']);
    expect(graph.nodes.find((n) => n.path === 'Strategy/B-1.md')?.id).toBeNull();
  });

  it('flags dates that are not dates', () => {
    expect(codes([bet('B-1', { deadline: 'soon' })])).toEqual(['invalid-date']);
    expect(codes([bet('B-1', { deadline: '2026-10-01' }), bet('B-2', { deadline: null })])).toEqual([]);
  });

  it('reports unparsable frontmatter', () => {
    expect(codes([{ ...note('x.md', {}), frontmatterError: 'bad' }])).toEqual(['invalid-frontmatter']);
  });

  it('flags malformed, dangling, non-strategy, self and wrongly typed links, creating no edge', () => {
    const target = bet('B-9');
    const assumption = note('Strategy/A-1.md', { id: 'A-1', type: 'assumption', status: 'unverified' });
    const links = { 'Strategy/B-9': target.path, nothing: null, 'B-1': 'Strategy/B-1.md', 'A-1': assumption.path, stray: 'Stray.md' };
    const source = bet('B-1', { serves: ['plain text', '[[nothing]]', '[[stray]]', '[[B-1]]', '[[A-1]]'], requires: '[[Strategy/B-9]]' }, links);
    const graph = buildGraph([source, target, assumption]);
    expect(graph.issues.map((i) => i.code).sort()).toEqual([
      'dangling-link', 'invalid-target-type', 'malformed-link', 'non-strategy-target', 'self-link',
    ]);
    expect(graph.edges.map((e) => e.key)).toEqual(['requires:B-1>B-9']);
  });

  it('treats a link missing from resolvedLinks as dangling', () => {
    expect(codes([bet('B-1', { serves: '[[B-2]]' })])).toEqual(['dangling-link']);
  });

  it('flags a relation field on a type that cannot have it', () => {
    const fixed = note('Strategy/F.md', { id: 'FP-1', type: 'fixed-point', serves: '[[B-1]]' }, { 'B-1': 'Strategy/B-1.md' });
    expect(codes([fixed, bet('B-1')])).toEqual(['field-not-allowed']);
  });

  it('accepts scalar or list values and dedupes repeated links', () => {
    const links = { 'B-2': 'Strategy/B-2.md' };
    const graph = buildGraph([bet('B-1', { next: '[[B-2]]', requires: ['[[B-2]]', '[[B-2|again]]'] }, links), bet('B-2')]);
    expect(graph.issues).toEqual([]);
    expect(graph.edges.map((e) => e.key).sort()).toEqual(['next:B-1>B-2', 'requires:B-1>B-2']);
  });
});
