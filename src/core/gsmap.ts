/**
 * `Strategy/Strategy.gsmap` (plan D3, D8): everything about the graph that is not note data.
 * Node positions keyed by note `id`, free cards, frames and links that involve cards.
 * Pure data and serialization; the graph view (Phase 5a) and the migration planner share it.
 */

export const GSMAP_VERSION = 1;
export const GSMAP_PATH = 'Strategy/Strategy.gsmap';

export interface GsPosition {
  x: number;
  y: number;
}

/** Visual attributes carried over from canvas `styleAttributes` (border, shape, textAlign, path, …). */
export type GsStyle = Record<string, string>;

interface GsRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Canvas color: a preset number ("1"–"6") or a hex string. */
  color?: string;
  style?: GsStyle;
}

/**
 * A card that exists only on the graph. `text` cards can later be promoted to a note
 * (Phase 7); `note-ref` cards point at a vault file that is not a strategy note; `link`
 * cards hold a URL.
 */
export type GsCard = GsRect & { id: string } & (
    | { kind: 'text'; text: string }
    | { kind: 'note-ref'; file: string }
    | { kind: 'link'; url: string }
  );

/** A labelled region (the old canvas groups). Purely visual. */
export type GsFrame = GsRect & { id: string; label: string };

/** A link end: a free card, or a strategy note by `id`. */
export type GsEndpoint = { card: string } | { note: string };

export type GsSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * A drawn line with no strategy meaning: anything touching a card, and note↔note
 * annotations the user chose to keep instead of turning into a relation.
 */
export interface GsLink {
  id: string;
  from: GsEndpoint;
  to: GsEndpoint;
  label?: string;
  color?: string;
  style?: GsStyle;
  fromSide?: GsSide;
  toSide?: GsSide;
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
}

export interface GsMap {
  version: typeof GSMAP_VERSION;
  viewport?: { x: number; y: number; zoom: number };
  positions: Record<string, GsPosition>;
  cards: GsCard[];
  frames: GsFrame[];
  links: GsLink[];
}

export function emptyGsMap(): GsMap {
  return { version: GSMAP_VERSION, positions: {}, cards: [], frames: [], links: [] };
}

/** Stable text form: tab-indented JSON like Obsidian's canvas files, trailing newline. */
export function serializeGsMap(map: GsMap): string {
  return JSON.stringify(map, null, '\t') + '\n';
}

export type GsMapRead = { ok: true; map: GsMap } | { ok: false; error: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPosition = (value: unknown): value is GsPosition =>
  isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y);

/**
 * Read a `.gsmap`. An empty file is an empty map (a freshly created one). Anything this
 * version can't vouch for is an error, never a guess: the graph view then shows the error
 * and refuses to write, so a file it doesn't understand is never overwritten.
 */
export function parseGsMap(text: string): GsMapRead {
  if (!text.trim()) return { ok: true, map: emptyGsMap() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!isObject(raw)) return { ok: false, error: 'not a JSON object' };
  if (raw.version !== GSMAP_VERSION) {
    return typeof raw.version === 'number' && raw.version > GSMAP_VERSION
      ? { ok: false, error: `written by a newer plugin (format version ${raw.version}; this one reads ${GSMAP_VERSION})` }
      : { ok: false, error: `unknown format version ${JSON.stringify(raw.version ?? null)} (expected ${GSMAP_VERSION})` };
  }
  const positions = raw.positions ?? {};
  if (!isObject(positions)) return { ok: false, error: '`positions` is not an object' };
  for (const [id, position] of Object.entries(positions)) {
    if (!isPosition(position)) return { ok: false, error: `position of "${id}" is not {x, y} numbers` };
  }
  for (const key of ['cards', 'frames', 'links'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return { ok: false, error: `\`${key}\` is not a list` };
  }
  const map: GsMap = {
    version: GSMAP_VERSION,
    positions: positions as Record<string, GsPosition>,
    cards: (raw.cards as GsCard[] | undefined) ?? [],
    frames: (raw.frames as GsFrame[] | undefined) ?? [],
    links: (raw.links as GsLink[] | undefined) ?? [],
  };
  if (raw.viewport !== undefined) map.viewport = raw.viewport as GsMap['viewport'];
  return { ok: true, map };
}

/**
 * Set node positions in a `.gsmap`'s text and return the new text. Only the given entries of
 * `positions` change: every other key, unknown ones included, keeps its value and order, so this
 * is safe to run on whatever is on disk at write time (`vault.process`). Coordinates are rounded
 * to whole pixels, as on a canvas. Throws when the text is not a `.gsmap` this version reads.
 */
export function writePositions(text: string, updates: Readonly<Record<string, GsPosition>>): string {
  const read = parseGsMap(text);
  if (!read.ok) throw new Error(`Strategy.gsmap can't be read: ${read.error}`);
  const raw = (text.trim() ? JSON.parse(text) : emptyGsMap()) as Record<string, unknown>;
  const positions = (raw.positions ??= {}) as Record<string, GsPosition>;
  for (const [id, { x, y }] of Object.entries(updates)) positions[id] = { x: Math.round(x), y: Math.round(y) };
  return JSON.stringify(raw, null, '\t') + '\n';
}

/**
 * Remove every saved node position from a `.gsmap`'s text, so every node is laid out automatically
 * again. Everything else (viewport, cards, frames, links, unknown keys) keeps its value and order.
 * Throws when the text is not a `.gsmap` this version reads.
 */
export function clearPositions(text: string): string {
  const read = parseGsMap(text);
  if (!read.ok) throw new Error(`Strategy.gsmap can't be read: ${read.error}`);
  const raw = (text.trim() ? JSON.parse(text) : emptyGsMap()) as Record<string, unknown>;
  raw.positions = {};
  return JSON.stringify(raw, null, '\t') + '\n';
}
