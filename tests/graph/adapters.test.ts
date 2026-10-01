import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../../src/core/memory-adapter';
import { ObsidianAdapter } from '../../src/obsidian/adapter';
import { FsAdapter } from '../../tools/fs-adapter';
import { readTestVault, TEST_VAULT_DIR } from '../support/fake-app';
import { md, migratedTestVault } from '../support/v2';

describe('MemoryAdapter', () => {
  it('returns only notes under the root, but resolves links across the whole vault', async () => {
    const notes = await new MemoryAdapter({
      'Strategy/B-1.md': md({ id: 'B-1', type: 'bet', serves: ['[[Outside]]', '[[Missing]]'] }),
      'Outside.md': '',
      'Elsewhere/N.md': md({ id: 'X' }),
      'Strategy/The Map.canvas': '{}',
    }).readNotes();
    expect(notes.map((n) => n.path)).toEqual(['Strategy/B-1.md']);
    expect(notes[0].basename).toBe('B-1');
    expect(notes[0].resolvedLinks).toEqual({ Outside: 'Outside.md', Missing: null });
  });

  it('can read the whole vault with an empty root', async () => {
    const notes = await new MemoryAdapter({ 'a.md': '', 'Strategy/b.md': '' }, { root: '' }).readNotes();
    expect(notes.map((n) => n.path)).toEqual(['Strategy/b.md', 'a.md']);
  });

  it('records frontmatter parse errors', async () => {
    const [note] = await new MemoryAdapter({ 'Strategy/x.md': '---\nid: [oops\n---\n' }).readNotes();
    expect(note.frontmatterError).toBeTruthy();
  });

  it('resolves the phantom root note and keeps the double-space basename', async () => {
    const notes = await new MemoryAdapter(readTestVault()).readNotes();
    const b6 = notes.find((n) => n.basename.startsWith('B-6'))!;
    expect(b6.resolvedLinks['FP-2 Profitable pottery business']).toBe('FP-2 Profitable pottery business.md');
    expect(notes.map((n) => n.basename)).toContain('B-7  Part-time barista job');
  });
});

describe('FsAdapter', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('reads the same notes as MemoryAdapter over the same files', async () => {
    const files = { ...migratedTestVault(), '.obsidian/app.json': '{}' };
    const dir = mkdtempSync(join(tmpdir(), 'gsg-fs-'));
    dirs.push(dir);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    const { '.obsidian/app.json': _skipped, ...expected } = files;
    expect(await new FsAdapter(dir).readNotes()).toEqual(await new MemoryAdapter(expected).readNotes());
  });

  it('reads every note under Strategy/ in the committed test vault', async () => {
    const notes = await new FsAdapter(TEST_VAULT_DIR).readNotes();
    expect(notes).toHaveLength(18); // 8 bets, 7 assumptions, 2 fixed points, Current Position
  });
});

describe('ObsidianAdapter', () => {
  const file = (path: string) => ({ path, basename: path.replace(/^.*\//, '').replace(/\.md$/, '') });
  const app = {
    vault: { getMarkdownFiles: () => [file('Strategy/Bets/B-2.md'), file('Strategy/Bets/B-1.md'), file('Templates/T.md')] },
    metadataCache: {
      getFileCache: (f: { path: string }) =>
        f.path === 'Strategy/Bets/B-1.md'
          ? { frontmatter: { id: 'B-1', type: 'bet', serves: ['[[B-2]]', '[[Gone]]'], position: { start: 0, end: 1 } } }
          : null,
      getFirstLinkpathDest: (linkpath: string, source: string) =>
        linkpath === 'B-2' && source === 'Strategy/Bets/B-1.md' ? file('Strategy/Bets/B-2.md') : null,
    },
  };

  it('reads Strategy/ notes from the metadata cache, resolving links with Obsidian\'s resolver', async () => {
    const notes = await new ObsidianAdapter(app as never).readNotes();
    expect(notes).toEqual([
      {
        path: 'Strategy/Bets/B-1.md', basename: 'B-1',
        frontmatter: { id: 'B-1', type: 'bet', serves: ['[[B-2]]', '[[Gone]]'] },
        resolvedLinks: { 'B-2': 'Strategy/Bets/B-2.md', Gone: null },
      },
      { path: 'Strategy/Bets/B-2.md', basename: 'B-2', frontmatter: {}, resolvedLinks: {} },
    ]);
  });
});
