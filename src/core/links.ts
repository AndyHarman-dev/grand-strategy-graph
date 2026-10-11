/**
 * Wikilinks in frontmatter values, and link-path resolution that follows
 * Obsidian's rules (`getFirstLinkpathDest`) rather than any naming convention.
 */

const WIKILINK = /\[\[([^\]]*)\]\]/g;

/** `[[path#heading^block|alias]]` → `path`. May be empty (`[[]]`). */
export function linkpathOf(inner: string): string {
  const pipe = inner.indexOf('|');
  const target = pipe === -1 ? inner : inner.slice(0, pipe);
  const cut = target.search(/[#^]/);
  return (cut === -1 ? target : target.slice(0, cut)).trim();
}

/**
 * The link paths of every wikilink inside one field value (a string, a list of
 * strings, or null/empty). `malformed` counts non-empty strings with no
 * wikilink at all, which the graph reports instead of guessing a target.
 */
export function readLinkField(value: unknown): { linkpaths: string[]; malformed: string[] } {
  const linkpaths: string[] = [];
  const malformed: string[] = [];
  const visit = (item: unknown): void => {
    if (item == null) return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item !== 'string') return void malformed.push(String(item));
    if (!item.trim()) return;
    const matches = Array.from(item.matchAll(WIKILINK));
    if (!matches.length) return void malformed.push(item);
    for (const match of matches) linkpaths.push(linkpathOf(match[1]));
  };
  visit(value);
  return { linkpaths, malformed };
}

/** Every linkpath appearing anywhere in a frontmatter object (adapters resolve these). */
export function collectLinkpaths(frontmatter: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === 'string') for (const m of value.matchAll(WIKILINK)) found.add(linkpathOf(m[1]));
  };
  Object.values(frontmatter).forEach(visit);
  return Array.from(found);
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Resolve a link path from `sourcePath` against the vault's file paths.
 * Matches Obsidian: case-insensitive, `.md` is implied when the link has no
 * extension, a bare name matches by basename anywhere, a path with folders
 * matches as a path suffix, and the closest match wins (same folder first, then
 * shortest path, then alphabetical). Whitespace is significant: a double space
 * in a link does not match a single space in a filename.
 */
export function resolveLinkpath(linkpath: string, sourcePath: string, filePaths: readonly string[]): string | null {
  const wanted = linkpath.trim().replace(/^\/+/, '').toLowerCase();
  if (!wanted) return null;
  const names = new Set([wanted, wanted + '.md']);
  const sourceFolder = folderOf(sourcePath);

  const matches = filePaths.filter((path) => {
    const lower = path.toLowerCase();
    for (const name of names) if (lower === name || lower.endsWith('/' + name)) return true;
    return false;
  });
  if (!matches.length) return null;

  const rank = (path: string) => [folderOf(path) === sourceFolder ? 0 : 1, path.length] as const;
  matches.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || (a < b ? -1 : a > b ? 1 : 0);
  });
  return matches[0];
}
