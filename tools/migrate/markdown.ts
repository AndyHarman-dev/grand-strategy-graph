/**
 * Byte-exact note splitting for the migration: frontmatter text vs body, and the
 * body's `##` sections. Everything here keeps the original bytes so that untouched
 * parts of a note can be compared verbatim.
 */

const FRONTMATTER = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;
const EMPTY_FRONTMATTER = /^(﻿?---[ \t]*\r?\n)()(---[ \t]*(?:\r?\n|$))/;

export interface SplitNote {
  /** Text before the YAML (the opening `---` line and a BOM, if any). Empty when there is no frontmatter. */
  open: string;
  /** The YAML between the fences, without its final line break. Null when the note has no frontmatter. */
  yaml: string | null;
  /** The closing `---` line including its line break. */
  close: string;
  /** Everything after the frontmatter, byte for byte. */
  body: string;
}

export function splitNote(content: string): SplitNote {
  const match = FRONTMATTER.exec(content) ?? EMPTY_FRONTMATTER.exec(content);
  if (!match) return { open: '', yaml: null, close: '', body: content };
  return { open: match[1], yaml: match[2], close: match[3], body: content.slice(match[0].length) };
}

export function joinNote(note: SplitNote): string {
  return note.yaml === null ? note.body : note.open + note.yaml + note.close + note.body;
}

export interface Section {
  /** Heading text without the `#`s, trimmed. Null for the text before the first heading. */
  heading: string | null;
  level: number;
  /** Line index of the heading (or 0 for the preamble). */
  start: number;
  /** Line index after the section's last line. */
  end: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*\r?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Line indices of ATX headings outside fenced code blocks, with their level and text. */
function headings(lines: readonly string[]): { index: number; level: number; text: string }[] {
  const found: { index: number; level: number; text: string }[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    const h = ATX.exec(line);
    if (h) found.push({ index, level: h[1].length, text: (h[2] ?? '').trim() });
  });
  return found;
}

/**
 * The `##`-level sections of a body split on `\n`. A section runs from its heading to the
 * next heading of level 1 or 2 (h3+ stay inside it), as `insertIntoSection` does. A
 * trailing empty line (the file's final line break) never belongs to a section.
 */
export function sections(lines: readonly string[]): Section[] {
  const last = lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  const tops = headings(lines).filter((h) => h.level <= 2);
  const out: Section[] = [];
  if (!tops.length || tops[0].index > 0) out.push({ heading: null, level: 0, start: 0, end: tops.length ? tops[0].index : last });
  tops.forEach((h, i) => out.push({ heading: h.text, level: h.level, start: h.index, end: i + 1 < tops.length ? tops[i + 1].index : last }));
  return out;
}

/** Managed headings are matched on their text, case-insensitively. */
export function sameHeading(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

export function eolOf(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}
