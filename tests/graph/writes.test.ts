import { describe, expect, it } from 'vitest';
import { appendLogLine, logLine, removeLinksFromField, replaceSection, runWrites, sectionText, splitFrontmatter } from '../../src/core/writes';
import { MemoryVault } from '../../src/core/memory-vault';
import { parseFrontmatter } from '../../src/core/frontmatter';

describe('appendLogLine', () => {
  const note = '## The Bet\ntext\n\n## Log\n*Weekly check-ins.*\n\n- 2026-07-05: created\n\n## Resolution\n- **Outcome:** \n';

  it('adds the line after the last entry of the log, keeping the blank line before the next heading', () => {
    expect(appendLogLine(note, '- 2026-10-04: on track')).toBe(
      '## The Bet\ntext\n\n## Log\n*Weekly check-ins.*\n\n- 2026-07-05: created\n- 2026-10-04: on track\n\n## Resolution\n- **Outcome:** \n'
    );
  });

  it('adds it at the end when the log is the last section, and keeps the final newline', () => {
    expect(appendLogLine('## Log\n- a\n', '- b')).toBe('## Log\n- a\n- b\n');
    expect(appendLogLine('## Log\n- a', '- b')).toBe('## Log\n- a\n- b');
  });

  it('adds a log section at the end of a note that has none', () => {
    expect(appendLogLine('## The Bet\ntext\n', '- x')).toBe('## The Bet\ntext\n\n## Log\n- x\n');
    expect(appendLogLine('', '- x')).toBe('## Log\n- x\n');
  });

  it('is not fooled by a Log heading inside a code block or a lookalike heading', () => {
    const tricky = '```\n## Log\n```\n\n### Log\n- nope\n';
    expect(appendLogLine(tricky, '- x')).toBe(tricky.trimEnd() + '\n\n## Log\n- x\n');
  });

  it('keeps CRLF line endings', () => {
    expect(appendLogLine('## Log\r\n- a\r\n\r\n## Next\r\n', '- b')).toBe('## Log\r\n- a\r\n- b\r\n\r\n## Next\r\n');
  });
});

describe('replaceSection', () => {
  const note = '## The Assumption\nstatement\n\n## How I\'d Know It\'s False\n*placeholder*\n\n## Verify By\ntext\n';
  it('replaces only the text under the heading', () => {
    expect(replaceSection(note, "## How I'd Know It's False", 'Rent above 1500')).toBe(
      "## The Assumption\nstatement\n\n## How I'd Know It's False\nRent above 1500\n\n## Verify By\ntext\n"
    );
  });
  it('replaces the last section and keeps the final newline', () => {
    expect(replaceSection('## A\nold\nmore\n', '## A', 'new')).toBe('## A\nnew\n');
  });
  it('adds a missing section at the end', () => {
    expect(replaceSection('## A\nx\n', '## B', 'y')).toBe('## A\nx\n\n## B\ny\n');
  });
  it('reads a section back', () => {
    expect(sectionText(note, "## How I'd Know It's False")).toBe('*placeholder*');
    expect(sectionText(note, '## Nope')).toBeNull();
  });
});

describe('splitFrontmatter and logLine', () => {
  it('splits at the closing line', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody\n')).toEqual({ head: '---\na: 1\n---\n', body: 'body\n' });
    expect(splitFrontmatter('no frontmatter')).toEqual({ head: '', body: 'no frontmatter' });
  });
  it('writes a dated line on one line', () => {
    expect(logLine('2026-10-04', '  first\n second ')).toBe('- 2026-10-04: first second');
  });
});

describe('removeLinksFromField', () => {
  it('takes a link out of a list and keeps the others', () => {
    expect(removeLinksFromField(['[[B-1 X]]', '[[B-2 Y|alias]]'], ['B-2 Y'])).toEqual(['[[B-1 X]]']);
    expect(removeLinksFromField(['[[B-1 X]]'], ['b-1 x'])).toEqual([]);
  });
  it('empties a scalar and matches a folder-qualified path', () => {
    expect(removeLinksFromField('[[Strategy/Bets/B-1 X]]', ['B-1 X'])).toBeNull();
  });
  it('returns the same value when nothing matches', () => {
    const list = ['[[B-1 X]]'];
    expect(removeLinksFromField(list, ['B-9'])).toBe(list);
    expect(removeLinksFromField(null, ['B-9'])).toBeNull();
  });
  it('removes an unquoted link YAML read as a nested list', () => {
    expect(removeLinksFromField([['B-1 X'], '[[B-2 Y]]'], ['B-1 X'])).toEqual(['[[B-2 Y]]']);
  });
});

describe('MemoryVault', () => {
  const note = '---\nid: B-1\ntype: bet\nstatus: active\ndeadline: 2026-12-01\ncategories:\n  - x\nserves:\n  - "[[FP-1 A]]"\n---\n## Log\n- a\n';
  it('edits frontmatter in place, keeping other keys, and leaves the body alone', async () => {
    const vault = new MemoryVault({ 'n.md': note });
    await vault.patchFrontmatter('n.md', (fm) => {
      fm.status = 'killed';
      fm.next = '[[B-2 B]]';
      (fm.serves as string[]).push('[[FP-2 C]]');
      delete fm.deadline;
    });
    const text = vault.files['n.md'];
    expect(text.endsWith('---\n## Log\n- a\n')).toBe(true);
    expect(parseFrontmatter(text).frontmatter).toEqual({
      id: 'B-1', type: 'bet', status: 'killed', categories: ['x'], serves: ['[[FP-1 A]]', '[[FP-2 C]]'], next: '[[B-2 B]]',
    });
  });
  it('patches the body without touching the frontmatter', async () => {
    const vault = new MemoryVault({ 'n.md': note });
    await vault.patchBody('n.md', (body) => appendLogLine(body, '- b'));
    expect(vault.files['n.md']).toBe(note + '- b\n');
  });
  it('refuses to create over a note and to patch a missing one', async () => {
    const vault = new MemoryVault({ 'n.md': note });
    await expect(vault.create('n.md', '')).rejects.toThrow('already exists');
    await expect(vault.patchBody('missing.md', (b) => b)).rejects.toThrow('Not a note');
  });
  it('keeps a null value as an empty key', async () => {
    const vault = new MemoryVault({ 'n.md': note });
    await vault.patchFrontmatter('n.md', (fm) => (fm.deadline = null));
    expect(vault.files['n.md']).toContain('\ndeadline:\n');
  });
});

describe('runWrites', () => {
  it('stops at the first failure and says what was done', async () => {
    const vault = new MemoryVault({ 'a.md': '---\nid: a\n---\n' });
    const result = await runWrites(
      [
        { kind: 'set-field', path: 'a.md', field: 'status', value: 'x' },
        { kind: 'set-field', path: 'missing.md', field: 'status', value: 'x' },
        { kind: 'set-field', path: 'a.md', field: 'never', value: 'x' },
      ],
      vault
    );
    expect(result.written).toEqual(['a.md (status)']);
    expect(String((result.error as Error).message)).toContain('Not a note');
    expect(vault.files['a.md']).not.toContain('never');
  });
});
