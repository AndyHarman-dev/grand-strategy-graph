/**
 * Idempotently add `line` to the `heading` section of `content`.
 *
 * - Presence is tested on the bare `[[Target]]` wikilink, NOT on the rendered
 *   `- [[Target]]` line: real assumption notes in this vault contain
 *   bullet-less backlinks (A-13, A-7), and a bullet-prefixed check would
 *   double-insert into those.
 * - The line goes after the LAST non-blank line of the section (i.e. after the
 *   template's italic placeholder and any existing backlinks), which is the
 *   shape every existing assumption note already has — not directly under the
 *   heading, and not at the very end of the file.
 */
export function insertIntoSection(content: string, heading: string, line: string, linkTarget: string): string {
  if (content.includes(linkTarget)) return content;

  const lines = content.split('\n');
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    // No such section: append one rather than dropping the backlink.
    const sep = content.length === 0 ? '' : content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    return content + sep + heading + '\n' + line + '\n';
  }

  // Section runs until the next h1/h2 (an h3 subsection still belongs to it).
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  let insertAt = headingIdx + 1;
  for (let i = sectionEnd - 1; i > headingIdx; i--) {
    if (lines[i].trim() !== '') {
      insertAt = i + 1;
      break;
    }
  }

  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}
