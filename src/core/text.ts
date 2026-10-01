import { ASSUMPTION_TITLE_MAX_LEN } from './constants';

// Characters Obsidian refuses (or mangles) in note filenames.
const FORBIDDEN_FILENAME_CHARS = /[#\[\]\^\|\/\\:\*]/g;

/**
 * Remove filename-hostile characters, collapse whitespace runs, trim.
 * Forbidden characters become a SPACE rather than being deleted outright, so
 * "SaaS/PLG focus" reads as "SaaS PLG focus" instead of "SaaSPLG focus" — the
 * Title field auto-fills from the free-text Y field, so word-gluing is a real
 * risk. The whitespace collapse below then cleans up the resulting runs.
 */
export function sanitizeTitle(raw: unknown): string {
  return String(raw == null ? '' : raw)
    .replace(FORBIDDEN_FILENAME_CHARS, ' ')
    // control chars would also break a filename
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trailing punctuation reads badly in a filename ("... together." / "... ,"). */
export function trimTrailingPunctuation(text: string): string {
  return text.replace(/[\s.,;!?\-–—]+$/, '').trim();
}

/**
 * Derive a filename-safe title for a brand-new assumption from its statement.
 * The form never collects a separate per-assumption title, so the statement is
 * the only source. Truncate on a word boundary when possible; never mid-word
 * unless the first "word" is itself longer than the budget.
 */
export function deriveAssumptionTitle(statement: unknown, maxLen?: number): string {
  const limit = typeof maxLen === 'number' ? maxLen : ASSUMPTION_TITLE_MAX_LEN;
  const clean = sanitizeTitle(statement);
  if (!clean) return '';
  if (clean.length <= limit) return trimTrailingPunctuation(clean) || clean;

  const hard = clean.slice(0, limit);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(limit / 2) ? hard.slice(0, lastSpace) : hard;
  return trimTrailingPunctuation(cut) || cut.trim();
}

/** YAML double-quoted scalar. JSON string syntax is a valid subset of it. */
export function yamlString(value: unknown): string {
  return JSON.stringify(String(value == null ? '' : value));
}

/** `**X:**` in the template — avoid `::**` if the user already typed a colon. */
export function stripTrailingColon(text: unknown): string {
  return String(text == null ? '' : text).replace(/\s*:\s*$/, '');
}
