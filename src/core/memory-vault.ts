/**
 * A vault held as path → markdown that planned writes can be performed on: the dev page's
 * stand-in for Obsidian, and the tests'. `files` is the live map (the dev page's `MemoryAdapter`
 * reads the same object), so a write shows up on the next read.
 */
import { parseDocument } from 'yaml';
import type { FileRef, VaultLike } from './plan';
import { splitFrontmatter, type WriteIO } from './writes';

export class MemoryVault implements VaultLike<FileRef>, WriteIO {
  constructor(readonly files: Record<string, string>) {}

  getMarkdownFiles(): FileRef[] {
    return Object.keys(this.files)
      .filter((path) => path.endsWith('.md'))
      .map((path) => ({ path, basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '') }));
  }

  getAbstractFileByPath(path: string): { path: string } | null {
    if (path in this.files) return { path };
    return Object.keys(this.files).some((p) => p.startsWith(path + '/')) ? { path } : null;
  }

  async create(path: string, content: string): Promise<void> {
    if (path in this.files) throw new Error('File already exists: ' + path);
    this.files[path] = content;
  }

  async patchFrontmatter(path: string, patch: (frontmatter: Record<string, unknown>) => void): Promise<void> {
    const text = this.read(path);
    const { head, body } = splitFrontmatter(text);
    const inner = head.replace(/^﻿?---\r?\n/, '').replace(/(?:^|\r?\n)---[ \t]*(?:\r?\n)?$/, '');
    const doc = parseDocument(inner);
    const before = (doc.toJS() ?? {}) as Record<string, unknown>;
    const after = structuredClone(before);
    patch(after);
    for (const key of Object.keys(before)) if (!(key in after)) doc.delete(key);
    for (const [key, value] of Object.entries(after)) if (JSON.stringify(value) !== JSON.stringify(before[key]) || !(key in before)) doc.set(key, value);
    this.files[path] = '---\n' + doc.toString({ nullStr: '' }).replace(/\n+$/, '') + '\n---\n' + body;
  }

  async patchBody(path: string, patch: (body: string) => string): Promise<void> {
    const text = this.read(path);
    const { head, body } = splitFrontmatter(text);
    const next = patch(body);
    if (next !== body) this.files[path] = head + next;
  }

  private read(path: string): string {
    const text = this.files[path];
    if (text === undefined) throw new Error('Not a note: ' + path);
    return text;
  }
}
