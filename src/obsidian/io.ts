import { TFile, type App } from 'obsidian';
import { splitFrontmatter, type WriteIO } from '../core/writes';

/** `err.message` when there is a truthy one, otherwise the stringified value. */
export function errorMessage(err: unknown): string {
  const e = err as { message?: unknown } | null | undefined;
  return e && e.message ? String(e.message) : String(err);
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  try {
    await app.vault.createFolder(path);
  } catch (err) {
    // Racy "already exists" is fine; anything else surfaces on the create call.
    console.warn('strategy-bet-creator: createFolder(' + path + ') failed', err);
  }
}

/**
 * Planned writes performed through Obsidian: new notes with `vault.create`, frontmatter with
 * `processFrontMatter`, bodies with `vault.process` (atomic read-modify-write, so an edit made in
 * the editor meanwhile is not lost). The body edit never sees or changes the frontmatter block.
 */
export class ObsidianIO implements WriteIO {
  constructor(private readonly app: App) {}

  async create(path: string, content: string): Promise<void> {
    const slash = path.lastIndexOf('/');
    if (slash > 0) await ensureFolder(this.app, path.slice(0, slash));
    await this.app.vault.create(path, content);
  }

  async patchFrontmatter(path: string, patch: (frontmatter: Record<string, unknown>) => void): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.noteAt(path), (fm: Record<string, unknown>) => patch(fm));
  }

  async patchBody(path: string, patch: (body: string) => string): Promise<void> {
    await this.app.vault.process(this.noteAt(path), (text) => {
      const { head, body } = splitFrontmatter(text);
      const next = patch(body);
      return next === body ? text : head + next;
    });
  }

  private noteAt(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('Not a note: ' + path);
    return file;
  }
}
