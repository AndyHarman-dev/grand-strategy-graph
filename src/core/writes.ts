/**
 * The writes a planned action makes, and the pure text and frontmatter edits behind them. The
 * planners (`actions.ts` for creating, `edits.ts` for changing) only describe writes; an `WriteIO`
 * performs them: Obsidian's in `src/obsidian/`, the in-memory one for the dev page and the tests.
 *
 * Existing notes change in exactly these ways and no others (plan Phases 4 and 6): a frontmatter
 * field is set, a link is added to or removed from a relation field, a dated line is appended
 * under `## Log`, or one named section is replaced (the assumption's falsifier). Nothing else in a
 * body is ever touched.
 */
import { addLinkToField } from './link-field';
import { linkpathOf } from './links';

export type RelationField = 'serves' | 'ultimately-serves' | 'requires' | 'next' | 'assumptions';

export type PlannedWrite =
  /** A new note. */
  | { kind: 'create'; path: string; content: string }
  /** Append `link` to the list field `field` of an existing note's frontmatter, unless it is already there. */
  | { kind: 'add-link'; path: string; field: RelationField; link: string }
  /** Take out of `field` every link whose path is one of `linkpaths` (as written, minus alias and heading). */
  | { kind: 'remove-link'; path: string; field: RelationField; linkpaths: string[] }
  /** Set a frontmatter field to a string, or empty it (`null`: the key stays, as the templates have it). */
  | { kind: 'set-field'; path: string; field: string; value: string | null }
  /** Append a line to the note's `## Log` section, creating the section when there is none. */
  | { kind: 'append-log'; path: string; line: string }
  /** Replace the text under a `## heading`, keeping the heading; the section is added at the end when missing. */
  | { kind: 'replace-section'; path: string; heading: string; text: string };

/** What a write needs from a vault. */
export interface WriteIO {
  create(path: string, content: string): Promise<void>;
  /** Change an existing note's frontmatter through `patch`, which edits the object in place. */
  patchFrontmatter(path: string, patch: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  /** Change an existing note's text below its frontmatter: `patch` gets the body and returns the new one. */
  patchBody(path: string, patch: (body: string) => string): Promise<void>;
}

/** Perform one write. Writes are independent of each other, so the caller decides the order and what a failure means. */
export async function runWrite(write: PlannedWrite, io: WriteIO): Promise<void> {
  switch (write.kind) {
    case 'create':
      return io.create(write.path, write.content);
    case 'add-link':
      return io.patchFrontmatter(write.path, (fm) => {
        const next = addLinkToField(fm[write.field], write.link);
        if (next !== fm[write.field]) fm[write.field] = next;
      });
    case 'remove-link':
      return io.patchFrontmatter(write.path, (fm) => {
        const next = removeLinksFromField(fm[write.field], write.linkpaths);
        if (next !== fm[write.field]) fm[write.field] = next;
      });
    case 'set-field':
      return io.patchFrontmatter(write.path, (fm) => {
        if (fm[write.field] !== write.value) fm[write.field] = write.value;
      });
    case 'append-log':
      return io.patchBody(write.path, (body) => appendLogLine(body, write.line));
    case 'replace-section':
      return io.patchBody(write.path, (body) => replaceSection(body, write.heading, write.text));
  }
}

/** Perform writes in order, stopping at the first failure. `written` lists what was done before it, for the report. */
export async function runWrites(writes: readonly PlannedWrite[], io: WriteIO): Promise<{ written: string[]; error: unknown }> {
  const written: string[] = [];
  try {
    for (const write of writes) {
      await runWrite(write, io);
      written.push(describeWrite(write));
    }
  } catch (error) {
    return { written, error: error ?? new Error('Write failed.') };
  }
  return { written, error: null };
}

/** A short description of a write for "already written" reports. */
export function describeWrite(write: PlannedWrite): string {
  switch (write.kind) {
    case 'create':
      return write.path;
    case 'add-link':
    case 'remove-link':
    case 'set-field':
      return `${write.path} (${write.field})`;
    case 'append-log':
      return `${write.path} (log)`;
    case 'replace-section':
      return `${write.path} (${write.heading})`;
  }
}

// ------------------------------------------------------------------ frontmatter

const comparable = (linkpath: string) => linkpath.trim().replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase();

/**
 * `value` without the links whose path is in `linkpaths`, as Obsidian hands a relation field over:
 * nothing, one string or a list. Returns the same value when nothing matched, so callers can tell
 * nothing changed. A scalar that matches becomes empty (`null`, the key stays); a list keeps its
 * other entries. A match ignores case, alias, heading and a folder prefix on either side.
 */
export function removeLinksFromField(value: unknown, linkpaths: readonly string[]): unknown {
  const wanted = linkpaths.map(comparable);
  const matches = (path: string) => {
    const p = comparable(linkpathOf(path));
    return wanted.some((w) => p === w || p.endsWith('/' + w) || w.endsWith('/' + p));
  };
  // True when the string is one link to a wanted path. An unquoted `[[x]]` reaches us as a nested list.
  const hit = (item: unknown, nested: boolean): boolean => {
    if (Array.isArray(item)) return item.length > 0 && item.every((i) => hit(i, true));
    if (typeof item !== 'string') return false;
    const links = Array.from(item.matchAll(/\[\[([^\]]*)\]\]/g));
    if (links.length) return links.every((m) => matches(m[1]));
    return nested && matches(item);
  };
  if (value == null || value === '') return value;
  if (Array.isArray(value)) {
    const kept = value.filter((item) => !hit(item, false));
    return kept.length === value.length ? value : kept;
  }
  return typeof value === 'string' && hit(value, false) ? null : value;
}

// ------------------------------------------------------------------ body

const FRONTMATTER_BLOCK = /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** The text split into its frontmatter block (with the closing `---` line) and the rest. */
export function splitFrontmatter(text: string): { head: string; body: string } {
  const match = FRONTMATTER_BLOCK.exec(text);
  const head = match ? match[0] : '';
  return { head, body: text.slice(head.length) };
}

const HEADING = /^#{1,6}\s/;
const levelOf = (line: string) => /^#+/.exec(line)![0].length;

/** `[start, end)` lines of the section under `heading` (the heading line excluded), or null. Fenced code is skipped over. */
function findSection(lines: string[], heading: string): { start: number; end: number } | null {
  const level = levelOf(heading);
  let fence: string | null = null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMark = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMark) {
      if (fence === null) fence = fenceMark[1][0];
      else if (fenceMark[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null || !HEADING.test(line)) continue;
    if (start >= 0) {
      if (levelOf(line) <= level) return { start, end: i };
    } else if (line.trimEnd() === heading) start = i + 1;
  }
  return start >= 0 ? { start, end: lines.length } : null;
}

const LOG_HEADING = '## Log';

/**
 * `line` added at the end of the `## Log` section: after its last non-blank line, so the blank
 * line before the next heading stays. A note without the section gets one at the end.
 */
export function appendLogLine(body: string, line: string): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const section = findSection(lines, LOG_HEADING);
  if (!section) {
    const trimmed = body.replace(/\s+$/, '');
    return (trimmed ? trimmed + eol + eol : '') + LOG_HEADING + eol + line + eol;
  }
  let at = section.end;
  while (at > section.start && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, line);
  return lines.join(eol);
}

/**
 * The text under `heading` replaced by `text`, with a blank line around it. A missing section is
 * added at the end of the note. Everything outside the section stays byte for byte.
 */
export function replaceSection(body: string, heading: string, text: string): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const section = findSection(lines, heading);
  const content = text.replace(/\r?\n/g, eol).trim();
  if (!section) {
    const trimmed = body.replace(/\s+$/, '');
    return (trimmed ? trimmed + eol + eol : '') + heading + eol + content + eol;
  }
  const last = section.end === lines.length;
  // Not the last section: a blank line before the next heading. The last one keeps the note's final newline.
  const replacement = last ? [content, ...(body.endsWith('\n') ? [''] : [])] : [content, ''];
  lines.splice(section.start, section.end - section.start, ...replacement);
  return lines.join(eol);
}

/** `- YYYY-MM-DD: text`, the form every log line has. */
export function logLine(date: string, text: string): string {
  return `- ${date}: ${text.trim().replace(/\s*\r?\n\s*/g, ' ')}`;
}

/** The text of the section under `heading` (trimmed), or null when the note has no such section. */
export function sectionText(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/);
  const section = findSection(lines, heading);
  return section ? lines.slice(section.start, section.end).join('\n').trim() : null;
}
