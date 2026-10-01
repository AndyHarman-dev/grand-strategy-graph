import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { VaultAdapter } from '../src/core/adapter';
import { MemoryAdapter, type MemoryAdapterOptions } from '../src/core/memory-adapter';
import type { NoteRecord } from '../src/core/schema';

/** Every file under `dir` as vault-relative path → text, skipping Obsidian's config folder. */
export function readVaultFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.obsidian') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files[relative(dir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

/** A vault folder on disk (read-only). For the CLIs and tests. */
export class FsAdapter implements VaultAdapter {
  constructor(private readonly dir: string, private readonly options: MemoryAdapterOptions = {}) {}

  readNotes(): Promise<NoteRecord[]> {
    return new MemoryAdapter(readVaultFiles(this.dir), this.options).readNotes();
  }
}
