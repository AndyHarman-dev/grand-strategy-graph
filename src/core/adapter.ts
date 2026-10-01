import type { NoteRecord } from './schema';

/**
 * Where notes come from. Implementations: `ObsidianAdapter` (src/obsidian),
 * `FsAdapter` (tools/, Node), `MemoryAdapter` (src/core, dev page and tests).
 * Each resolves frontmatter links itself, so the core never sees a vault.
 */
export interface VaultAdapter {
  readNotes(): Promise<NoteRecord[]>;
}
