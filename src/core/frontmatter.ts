import { parse } from 'yaml';

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  error?: string;
}

const BLOCK = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Frontmatter of a markdown string. Dates stay strings (YAML core schema), as in Obsidian. */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const match = BLOCK.exec(markdown.replace(/^﻿/, ''));
  if (!match || !match[1]) return { frontmatter: {} };
  try {
    const value: unknown = parse(match[1]);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { frontmatter: value as Record<string, unknown> };
    }
    return { frontmatter: {}, error: 'Frontmatter is not a key/value map.' };
  } catch (e) {
    return { frontmatter: {}, error: e instanceof Error ? e.message : String(e) };
  }
}
