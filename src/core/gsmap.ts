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

const isRect = (item: Record<string, unknown>) => ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(item[key]));
const isEndpoint = (end: unknown) => isObject(end) && (typeof end.card === 'string' || typeof end.note === 'string');

/**
 * What is wrong with the first card, frame or link that the graph could not draw, or null. The
 * graph reads these items without checking again, so a file with one that is not what it says is
 * an error like any other this version can't vouch for, never a crash while drawing.
 */
function firstBadItem(raw: Record<string, unknown>): string | null {
  const items = (key: 'cards' | 'frames' | 'links') => (raw[key] as unknown[] | undefined) ?? [];
  for (const [i, card] of items('cards').entries()) {
    const text = isObject(card) ? (card.kind === 'text' ? card.text : card.kind === 'note-ref' ? card.file : card.kind === 'link' ? card.url : undefined) : undefined;
    if (!isObject(card) || typeof card.id !== 'string' || typeof text !== 'string' || !isRect(card)) {
      return `card ${i + 1} is not a card (it needs an id, a kind with its text, file or url, and x, y, width and height numbers)`;
    }
  }
  for (const [i, frame] of items('frames').entries()) {
    if (!isObject(frame) || typeof frame.id !== 'string' || typeof frame.label !== 'string' || !isRect(frame)) {
      return `frame ${i + 1} is not a frame (it needs an id, a label, and x, y, width and height numbers)`;
    }
  }
  for (const [i, link] of items('links').entries()) {
    if (!isObject(link) || typeof link.id !== 'string' || !isEndpoint(link.from) || !isEndpoint(link.to)) {
      return `link ${i + 1} is not a link (it needs an id, and a from and a to that name a card or a note)`;
    }
  }
  return null;
}

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
  const bad = firstBadItem(raw);
  if (bad) return { ok: false, error: bad };
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

// ------------------------------------------------------------------ free cards, frames and links (Phase 7)

/**
 * A change to the free-form part of the map. Cards, frames and links are edited as whole
 * objects by `id`, so two edits of different ones never clash, and the same op twice is the same
 * as once (a promote or a delete that was already done is a no-op). Node positions are not ops:
 * they have their own, smaller path (`writePositions`).
 */
export type GsOp =
  /** Add the card, or replace the one with this `id`. */
  | { op: 'put-card'; card: GsCard }
  /** Remove the card and the links on it. */
  | { op: 'delete-card'; id: string }
  | { op: 'put-frame'; frame: GsFrame }
  | { op: 'delete-frame'; id: string }
  | { op: 'put-link'; link: GsLink }
  | { op: 'delete-link'; id: string }
  /**
   * The card became the note with this `id`: the card goes, its links end on the note instead, and
   * the note takes the card's place (unless it already has one).
   */
  | { op: 'promote-card'; card: string; note: string };

type RawList = Record<string, unknown>[];

const idOf = (item: unknown) => (isObject(item) ? item.id : undefined);

function listOf(raw: Record<string, unknown>, key: 'cards' | 'frames' | 'links'): RawList {
  return (raw[key] ??= []) as RawList;
}

function upsert(list: RawList, item: { id: string }): void {
  const at = list.findIndex((existing) => idOf(existing) === item.id);
  if (at >= 0) list[at] = item as unknown as Record<string, unknown>;
  else list.push(item as unknown as Record<string, unknown>);
}

function remove(list: RawList, id: string): void {
  const at = list.findIndex((existing) => idOf(existing) === id);
  if (at >= 0) list.splice(at, 1);
}

const endsOnCard = (link: unknown, card: string) =>
  isObject(link) && [link.from, link.to].some((end) => isObject(end) && end.card === card);

/**
 * Apply ops to a `.gsmap`'s text and return the new text. Only the touched cards, frames and links
 * change: every other key, unknown ones included, keeps its value and order, so this is safe to
 * run on whatever is on disk at write time (`vault.process`). Throws when the text is not a
 * `.gsmap` this version reads.
 */
export function writeOps(text: string, ops: readonly GsOp[]): string {
  const read = parseGsMap(text);
  if (!read.ok) throw new Error(`Strategy.gsmap can't be read: ${read.error}`);
  const raw = (text.trim() ? JSON.parse(text) : emptyGsMap()) as Record<string, unknown>;
  for (const op of ops) {
    switch (op.op) {
      case 'put-card':
        upsert(listOf(raw, 'cards'), op.card);
        break;
      case 'delete-card':
        remove(listOf(raw, 'cards'), op.id);
        raw.links = listOf(raw, 'links').filter((link) => !endsOnCard(link, op.id));
        break;
      case 'put-frame':
        upsert(listOf(raw, 'frames'), op.frame);
        break;
      case 'delete-frame':
        remove(listOf(raw, 'frames'), op.id);
        break;
      case 'put-link':
        upsert(listOf(raw, 'links'), op.link);
        break;
      case 'delete-link':
        remove(listOf(raw, 'links'), op.id);
        break;
      case 'promote-card': {
        const cards = listOf(raw, 'cards');
        const card = cards.find((c) => idOf(c) === op.card);
        if (!card) break;
        for (const link of listOf(raw, 'links')) {
          for (const key of ['from', 'to'] as const) {
            const end = link[key];
            if (isObject(end) && end.card === op.card) link[key] = { note: op.note };
          }
        }
        const positions = (raw.positions ??= {}) as Record<string, GsPosition>;
        if (!(op.note in positions) && Number.isFinite(card.x) && Number.isFinite(card.y)) {
          positions[op.note] = { x: Math.round(card.x as number), y: Math.round(card.y as number) };
        }
        remove(cards, op.card);
        break;
      }
    }
  }
  return JSON.stringify(raw, null, '\t') + '\n';
}

/** `map` with the ops applied, for what is shown before they are written. Same result as writing them and reading the file back. */
export function applyOps(map: GsMap, ops: readonly GsOp[]): GsMap {
  if (!ops.length) return map;
  const read = parseGsMap(writeOps(serializeGsMap(map), ops));
  if (!read.ok) throw new Error(read.error);
  return map.viewport ? { ...read.map, viewport: map.viewport } : read.map;
}
