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
