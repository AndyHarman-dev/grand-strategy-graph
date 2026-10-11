/** Minimal unified diff (line LCS), enough to review planned note changes. No dependency. */

function lcsTable(a: readonly string[], b: readonly string[]): Uint32Array[] {
  const t = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  }
  return t;
}

type Op = { op: ' ' | '-' | '+'; line: string; a: number; b: number };

function ops(a: readonly string[], b: readonly string[]): Op[] {
  const t = lcsTable(a, b);
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ op: ' ', line: a[i], a: i++, b: j++ });
    else if (i < a.length && (j === b.length || t[i + 1][j] >= t[i][j + 1])) out.push({ op: '-', line: a[i], a: i++, b: j });
    else out.push({ op: '+', line: b[j], a: i, b: j++ });
  }
  return out;
}

const lines = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

/** A unified diff of one file; `before` null means a new file. Empty when nothing changed. */
export function unifiedDiff(path: string, before: string | null, after: string, context = 3): string {
  if (before === after) return '';
  const a = before === null ? [] : lines(before);
  const b = lines(after);
  const all = ops(a, b);
  const changed = all.map((o, i) => (o.op === ' ' ? -1 : i)).filter((i) => i !== -1);
  const header = [`diff --migrate a/${path} b/${path}`, before === null ? '--- /dev/null' : `--- a/${path}`, `+++ b/${path}`];
  const hunks: string[] = [];
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, changed[k] - context);
    let end = changed[k];
    while (k + 1 < changed.length && changed[k + 1] - end <= 2 * context) end = changed[++k];
    end = Math.min(all.length - 1, end + context);
    k++;
    const slice = all.slice(start, end + 1);
    const aLen = slice.filter((o) => o.op !== '+').length;
    const bLen = slice.filter((o) => o.op !== '-').length;
    const aStart = aLen ? slice.find((o) => o.op !== '+')!.a + 1 : slice[0].a;
    const bStart = bLen ? slice.find((o) => o.op !== '-')!.b + 1 : slice[0].b;
    hunks.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`, ...slice.map((o) => o.op + o.line));
  }
  const noEol = (text: string | null) => text !== null && text !== '' && !text.endsWith('\n');
  if (noEol(before) !== noEol(after)) hunks.push('\\ trailing newline changed');
  return [...header, ...hunks].join('\n') + '\n';
}
