import type { VaultAdapter } from './adapter';
import { parseFrontmatter } from './frontmatter';
import { collectLinkpaths, resolveLinkpath } from './links';
import type { NoteRecord } from './schema';

export interface MemoryAdapterOptions {
  /** Only notes under this folder become records. Links still resolve across the whole vault. */
  root?: string;
}

export const STRATEGY_ROOT = 'Strategy';

/** A vault held as path → markdown. Also the base of `FsAdapter`. */
export class MemoryAdapter implements VaultAdapter {
  private readonly root: string;

  constructor(private readonly files: Readonly<Record<string, string>>, options: MemoryAdapterOptions = {}) {
    this.root = (options.root ?? STRATEGY_ROOT).replace(/\/+$/, '');
  }

  async readNotes(): Promise<NoteRecord[]> {
    const paths = Object.keys(this.files);
    const prefix = this.root ? this.root + '/' : '';
    return paths
      .filter((path) => path.endsWith('.md') && path.startsWith(prefix))
      .sort()
      .map((path) => {
        const { frontmatter, error } = parseFrontmatter(this.files[path]);
        const resolvedLinks: Record<string, string | null> = {};
        for (const linkpath of collectLinkpaths(frontmatter)) {
          resolvedLinks[linkpath] = resolveLinkpath(linkpath, path, paths);
        }
        const name = path.slice(path.lastIndexOf('/') + 1);
        const record: NoteRecord = { path, basename: name.replace(/\.md$/, ''), frontmatter, resolvedLinks };
        if (error) record.frontmatterError = error;
        return record;
      });
  }
}
