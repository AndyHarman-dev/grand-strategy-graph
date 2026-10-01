import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../src/core/frontmatter';

describe('parseFrontmatter', () => {
  it('parses a block and keeps dates as strings', () => {
    const md = '---\nid: A-1\ncreated: 2026-07-05T10:00:00\nverify-by: 2026-07-20\nserves:\n  - "[[x]]"\n---\n# body\n';
    expect(parseFrontmatter(md).frontmatter).toEqual({
      id: 'A-1', created: '2026-07-05T10:00:00', 'verify-by': '2026-07-20', serves: ['[[x]]'],
    });
  });

  it('keeps keys with spaces and null values', () => {
    expect(parseFrontmatter('---\nnext sequel:\ndeadline:\n---\n').frontmatter).toEqual({ 'next sequel': null, deadline: null });
  });

  it('gives an empty object when there is none', () => {
    expect(parseFrontmatter('no frontmatter')).toEqual({ frontmatter: {} });
    expect(parseFrontmatter('')).toEqual({ frontmatter: {} });
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ frontmatter: {} });
  });

  it('copes with CRLF and a BOM', () => {
    expect(parseFrontmatter('﻿---\r\nid: B-1\r\n---\r\nbody').frontmatter).toEqual({ id: 'B-1' });
  });

  it('reports invalid YAML and non-map frontmatter instead of throwing', () => {
    expect(parseFrontmatter('---\nid: [unclosed\n---\n').error).toBeTruthy();
    expect(parseFrontmatter('---\n- a\n- b\n---\n')).toEqual({ frontmatter: {}, error: 'Frontmatter is not a key/value map.' });
  });
});
