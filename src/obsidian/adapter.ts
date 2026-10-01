import type { App } from 'obsidian';
import type { VaultAdapter } from '../core/adapter';
import { collectLinkpaths } from '../core/links';
import { STRATEGY_ROOT } from '../core/memory-adapter';
import type { NoteRecord } from '../core/schema';

/** Notes straight from Obsidian's caches; links resolve with Obsidian's own resolver. */
export class ObsidianAdapter implements VaultAdapter {
  constructor(private readonly app: App, private readonly root: string = STRATEGY_ROOT) {}

  async readNotes(): Promise<NoteRecord[]> {
    const { vault, metadataCache } = this.app;
    const prefix = this.root ? this.root.replace(/\/+$/, '') + '/' : '';
    return vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => {
        // The cache adds a `position` entry that is not frontmatter.
        const { position: _position, ...frontmatter } = (metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
        const resolvedLinks: Record<string, string | null> = {};
        for (const linkpath of collectLinkpaths(frontmatter)) {
          resolvedLinks[linkpath] = metadataCache.getFirstLinkpathDest(linkpath, file.path)?.path ?? null;
        }
        return { path: file.path, basename: file.basename, frontmatter, resolvedLinks };
      });
  }
}
