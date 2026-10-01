import { Document, isMap, isScalar, isSeq, Pair, parseDocument, Scalar, YAMLMap, YAMLSeq } from 'yaml';

/** No line folding: a long `expected-result` must come back on one line. */
const STRINGIFY = { lineWidth: 0 } as const;

export interface ParsedYaml {
  doc: Document | null;
  /** Plain JS value of the frontmatter map (dates stay strings, as in Obsidian). */
  data: Record<string, unknown>;
  /** Why the YAML can't be edited safely; the note is then never rewritten. */
  error?: string;
}

/**
 * Parse frontmatter for editing. Refuses YAML that is not a map, has errors, or would not
 * re-serialize byte for byte when left unchanged, so that every edit is the only diff.
 */
export function parseYaml(yaml: string): ParsedYaml {
  const doc = parseDocument(yaml);
  if (doc.errors.length) return { doc: null, data: {}, error: doc.errors[0].message.split('\n')[0] };
  if (doc.contents !== null && !isMap(doc.contents)) return { doc: null, data: {}, error: 'frontmatter is not a key/value map' };
  if (doc.contents === null) doc.contents = new YAMLMap() as never;
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  const normalized = yaml.replace(/\r\n/g, '\n');
  const roundTrip = doc.toString(STRINGIFY);
  if (normalized.trim() !== '' && roundTrip !== normalized + '\n') {
    return { doc: null, data, error: 'frontmatter would not re-serialize unchanged (unusual YAML formatting)' };
  }
  return { doc, data };
}

export function stringifyYaml(doc: Document, eol: '\n' | '\r\n'): string {
  const text = isMap(doc.contents) && doc.contents.items.length === 0 ? '' : doc.toString(STRINGIFY).replace(/\n$/, '');
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

function map(doc: Document): YAMLMap {
  return doc.contents as YAMLMap;
}

function keyOf(pair: Pair): string | null {
  return isScalar(pair.key) ? String(pair.key.value) : typeof pair.key === 'string' ? pair.key : null;
}

export function findPair(doc: Document, key: string): Pair | undefined {
  return map(doc).items.find((p) => keyOf(p as Pair) === key) as Pair | undefined;
}

export function pairIndex(doc: Document, key: string): number {
  return map(doc).items.findIndex((p) => keyOf(p as Pair) === key);
}

/** `key:` with nothing after it, like the legacy notes write empty fields. */
export function emptyValue(): Scalar {
  const s = new Scalar(null);
  s.source = '';
  return s;
}

export function quoted(text: string): Scalar {
  const s = new Scalar(text);
  s.type = Scalar.QUOTE_DOUBLE;
  return s;
}

/** Insert `key: value` at `index` (clamped). Returns the new pair. */
export function insertPair(doc: Document, index: number, key: string, value: unknown): Pair {
  const pair = new Pair(new Scalar(key), value);
  const items = map(doc).items;
  items.splice(Math.max(0, Math.min(index, items.length)), 0, pair as never);
  return pair;
}

export function removePair(doc: Document, key: string): void {
  const items = map(doc).items;
  const i = pairIndex(doc, key);
  if (i !== -1) items.splice(i, 1);
}

export function renameKey(pair: Pair, key: string): void {
  if (isScalar(pair.key)) pair.key.value = key;
  else pair.key = new Scalar(key);
}

/** Set a scalar in place, keeping its node (and so its quoting) when there is one. */
export function setScalar(pair: Pair, value: string): void {
  if (isScalar(pair.value) && pair.value.value !== null) pair.value.value = value;
  else pair.value = new Scalar(value);
}

/** The items of a value as nodes: a seq's items, one scalar, or none. */
export function valueNodes(pair: Pair): unknown[] {
  if (isSeq(pair.value)) return [...pair.value.items];
  if (pair.value == null || (isScalar(pair.value) && (pair.value.value === null || pair.value.value === ''))) return [];
  return [pair.value];
}

/** Replace a value with a list of nodes, reusing the existing seq node so its style is kept. */
export function setList(pair: Pair, items: unknown[]): void {
  if (!items.length) {
    pair.value = emptyValue();
    return;
  }
  const seq = isSeq(pair.value) ? pair.value : new YAMLSeq();
  seq.items = items as never[];
  pair.value = seq;
}
