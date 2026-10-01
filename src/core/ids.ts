export interface ParsedIds {
  ids: number[];
  used: Set<number>;
  invalid: string[];
  duplicates: number[];
  max: number;
}

/**
 * Parse `B-<n>` / `A-<n>` ids out of basenames.
 * Deliberately anchored + digit-greedy rather than whitespace-split, because
 * real data contains `B-10  byTalent backend engineer` (double space).
 * Returns every signal the caller needs to refuse to write on ambiguity.
 */
export function parseIds(basenames: readonly string[], prefix: string): ParsedIds {
  const re = new RegExp('^' + prefix + '-(\\d+)');
  const ids: number[] = [];
  const invalid: string[] = [];
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  for (const basename of basenames) {
    const match = re.exec(basename);
    if (!match) continue; // not an id-bearing note; ignored, not an error
    const n = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(n) || n < 0) {
      invalid.push(basename);
      continue;
    }
    if (seen.has(n)) duplicates.add(n);
    seen.add(n);
    ids.push(n);
  }

  return {
    ids,
    used: seen,
    invalid,
    duplicates: Array.from(duplicates).sort((a, b) => a - b),
    max: ids.length ? Math.max(...ids) : 0,
  };
}
