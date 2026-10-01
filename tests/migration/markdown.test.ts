import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../../tools/migrate/diff';
import { joinNote, sections, splitNote } from '../../tools/migrate/markdown';
import { parseResolutions, renderResolutions } from '../../tools/migrate/report';
import { planMigration } from '../../tools/migrate/plan';

describe('splitNote', () => {
  it.each([
    ['plain', '---\na: 1\n---\nBody\n'],
    ['CRLF', '---\r\na: 1\r\n---\r\nBody\r\n'],
    ['BOM', '﻿---\na: 1\n---\nBody'],
    ['empty frontmatter', '---\n---\nBody\n'],
    ['no frontmatter', '# Title\n---\nnot yaml\n'],
    ['frontmatter only, no final newline', '---\na: 1\n---'],
  ])('round-trips %s byte for byte', (_name, text) => {
    expect(joinNote(splitNote(text))).toBe(text);
  });

  it('separates the YAML from the body', () => {
    expect(splitNote('---\na: 1\nb: 2\n---\n## H\n')).toEqual({ open: '---\n', yaml: 'a: 1\nb: 2', close: '\n---\n', body: '## H\n' });
    expect(splitNote('# T\n').yaml).toBeNull();
  });
});

describe('sections', () => {
  it('splits on h1/h2, keeps h3 inside, ignores fenced code, and leaves the final line break out', () => {
    const lines = 'intro\n## A\n### sub\n```\n## not a heading\n```\n# B\ntext\n'.split('\n');
    expect(sections(lines).map((s) => [s.heading, s.start, s.end])).toEqual([[null, 0, 1], ['A', 1, 6], ['B', 6, 8]]);
  });
});

describe('unifiedDiff', () => {
  it('shows removals before additions with context', () => {
    expect(unifiedDiff('n.md', 'a\nb\nc\n', 'a\nB\nc\n')).toBe('diff --migrate a/n.md b/n.md\n--- a/n.md\n+++ b/n.md\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
    expect(unifiedDiff('n.md', null, 'x\n')).toBe('diff --migrate a/n.md b/n.md\n--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,1 @@\n+x\n');
    expect(unifiedDiff('n.md', 'same', 'same')).toBe('');
  });
});

describe('resolutions.yaml', () => {
  it('round-trips answers, keeps rejection reasons and stale answers', () => {
    const files = { 'Strategy/Bets/B-1 X.md': '---\ntype: bet\nstatus: paused\nserves: "[[nowhere]]"\n---\n' };
    const previous = { 'status: Strategy/Bets/B-1 X.md': 'sleeping', 'old question': 'drop' };
    const plan = planMigration(files, { resolutions: previous });
    const text = renderResolutions(plan, previous, '2026-10-01');
    expect(text).toContain('error: expected one of active, dormant, won, killed, extended');
    expect(parseResolutions(text)).toEqual(previous);
    expect(() => parseResolutions('version: 9\n')).toThrow('Unsupported resolutions version 9');
  });
});
