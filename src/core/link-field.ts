import { linkpathOf } from './links';

/** Link path to compare by: lower case, no `.md`, no leading slash. */
const comparable = (linkpath: string) => linkpath.trim().replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase();

/**
 * `link` appended to a frontmatter list value, as Obsidian hands it over: nothing, one string
 * or a list. Returns the same value when the link is already there, so callers can tell
 * nothing changed. A match ignores case, alias and heading, accepts a folder-qualified path to
 * the same name (`[[Strategy/Bets/B-1 X]]` for `[[B-1 X]]`), and an unquoted `[[link]]`, which
 * YAML reads as a nested list (`[['B-1 X']]`).
 */
export function addLinkToField(value: unknown, link: string): unknown {
  const target = comparable(linkpathOf(link.replace(/^\[\[|\]\]$/g, '')));
  const same = (linkpath: string) => {
    const p = comparable(linkpathOf(linkpath));
    return p === target || p.endsWith('/' + target);
  };
  const has = (item: unknown, nested: boolean): boolean => {
    if (Array.isArray(item)) return item.some((i) => has(i, true));
    if (typeof item !== 'string') return false;
    const links = Array.from(item.matchAll(/\[\[([^\]]*)\]\]/g));
    // Inside a nested list the brackets were eaten by YAML, so the bare string is the link.
    return links.length ? links.some((m) => same(m[1])) : nested && same(item);
  };
  if (value == null || value === '') return [link];
  if (Array.isArray(value)) return value.some((i) => has(i, false)) ? value : [...value, link];
  if (typeof value === 'string') return has(value, false) ? value : [value, link];
  return [String(value), link];
}
