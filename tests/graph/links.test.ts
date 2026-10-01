import { describe, expect, it } from 'vitest';
import { collectLinkpaths, linkpathOf, readLinkField, resolveLinkpath } from '../../src/core/links';

describe('linkpathOf', () => {
  it('drops alias, heading and block parts', () => {
    expect(linkpathOf('B-1 Get a D7 visa|the visa')).toBe('B-1 Get a D7 visa');
    expect(linkpathOf('B-1 Get a D7 visa#Log')).toBe('B-1 Get a D7 visa');
    expect(linkpathOf('B-1 Get a D7 visa^abc')).toBe('B-1 Get a D7 visa');
    expect(linkpathOf('')).toBe('');
  });
});

describe('readLinkField', () => {
  it('reads scalars, lists and nested lists, and ignores empties', () => {
    expect(readLinkField('[[a]]').linkpaths).toEqual(['a']);
    expect(readLinkField(['[[a]]', '[[b|B]]']).linkpaths).toEqual(['a', 'b']);
    expect(readLinkField([['[[a]]']]).linkpaths).toEqual(['a']);
    expect(readLinkField(null)).toEqual({ linkpaths: [], malformed: [] });
    expect(readLinkField('  ')).toEqual({ linkpaths: [], malformed: [] });
  });

  it('keeps placeholder links as links and reports non-links as malformed', () => {
    expect(readLinkField('[[...]]').linkpaths).toEqual(['...']);
    expect(readLinkField('FP-1 Live in Portugal')).toEqual({ linkpaths: [], malformed: ['FP-1 Live in Portugal'] });
    expect(readLinkField(3).malformed).toEqual(['3']);
  });
});

describe('collectLinkpaths', () => {
  it('finds links in any field, once each', () => {
    expect(collectLinkpaths({ a: '[[x]]', b: ['[[y]]', '[[x]]'], c: 5, d: 'plain' }).sort()).toEqual(['x', 'y']);
  });
});

describe('resolveLinkpath', () => {
  const files = [
    'Strategy/Bets/B-1 Get a D7 visa.md',
    'Strategy/Bets/B-7  Part-time barista job.md',
    'Strategy/Assumptions/Notes.md',
    'Strategy/Bets/Notes.md',
    'Archive/Notes.md',
    'FP-2 Profitable pottery business.md',
    'Strategy/The Map.canvas',
  ];
  const from = 'Strategy/Bets/B-1 Get a D7 visa.md';

  it('matches by basename anywhere, case-insensitively, with .md implied', () => {
    expect(resolveLinkpath('b-1 get a d7 visa', 'x.md', files)).toBe('Strategy/Bets/B-1 Get a D7 visa.md');
    expect(resolveLinkpath('FP-2 Profitable pottery business', from, files)).toBe('FP-2 Profitable pottery business.md');
    expect(resolveLinkpath('The Map.canvas', from, files)).toBe('Strategy/The Map.canvas');
  });

  it('matches folder paths as suffixes', () => {
    expect(resolveLinkpath('Archive/Notes', from, files)).toBe('Archive/Notes.md');
    expect(resolveLinkpath('/Strategy/Bets/Notes', from, files)).toBe('Strategy/Bets/Notes.md');
  });

  it('prefers the same folder, then the shortest path', () => {
    expect(resolveLinkpath('Notes', from, files)).toBe('Strategy/Bets/Notes.md');
    expect(resolveLinkpath('Notes', 'Strategy/Assumptions/A.md', files)).toBe('Strategy/Assumptions/Notes.md');
    expect(resolveLinkpath('Notes', 'Elsewhere/x.md', files)).toBe('Archive/Notes.md');
  });

  it('does not collapse whitespace or match by id prefix', () => {
    expect(resolveLinkpath('B-7 Part-time barista job', from, files)).toBeNull();
    expect(resolveLinkpath('B-7  Part-time barista job', from, files)).toBe('Strategy/Bets/B-7  Part-time barista job.md');
    expect(resolveLinkpath('B-1', from, files)).toBeNull();
  });

  it('returns null for empty or placeholder paths', () => {
    expect(resolveLinkpath('', from, files)).toBeNull();
    expect(resolveLinkpath('...', from, files)).toBeNull();
    expect(resolveLinkpath('FP-', from, files)).toBeNull();
  });
});
