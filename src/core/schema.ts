/**
 * Schema v2 as types and tables (plan decisions D2–D7, D13, D16, D17).
 * Pure data: no `obsidian` import, no behavior beyond lookups.
 */

/** No `route` type (D16): a route is a `serves` chain from bets up to a fixed point. */
export const NODE_TYPES = ['bet', 'assumption', 'fixed-point', 'milestone', 'current-position'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Allowed `status` values per type. Types without an entry (fixed points, the
 * current position) carry no status, so nothing is checked. A milestone is a
 * checkpoint that is `open` until it is `reached` (D17).
 */
export const STATUSES = {
  bet: ['active', 'dormant', 'won', 'killed', 'extended'],
  assumption: ['unverified', 'confirmed', 'falsified', 'undeterminable'],
  milestone: ['open', 'reached'],
} as const satisfies Partial<Record<NodeType, readonly string[]>>;

export const EDGE_KINDS = ['serves', 'ultimately-serves', 'requires', 'next', 'assumption'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface RelationRule {
  /** Frontmatter field that holds the links. */
  field: string;
  kind: EdgeKind;
  /**
   * Per type that may carry the field, the types its links may point at.
   * A type without an entry cannot carry the field.
   */
  to: Readonly<Partial<Record<NodeType, readonly NodeType[]>>>;
}

/** One row per relationship field: which edge it makes, from whom, to what. */
export const RELATIONS: readonly RelationRule[] = [
  // A bet serves a bet, a milestone or a fixed point; a milestone serves the checkpoint or fixed point beyond it (D17).
  { field: 'serves', kind: 'serves', to: { bet: ['bet', 'milestone', 'fixed-point'], milestone: ['milestone', 'fixed-point'] } },
  { field: 'ultimately-serves', kind: 'ultimately-serves', to: { bet: ['fixed-point'] } },
  // Prerequisites: bets, or milestones that must be reached first (D17). A milestone or a fixed point
  // can require them too: all of them must be done before it is (the graph draws an "AND" for two or more).
  { field: 'requires', kind: 'requires', to: { bet: ['bet', 'milestone'], milestone: ['bet', 'milestone'], 'fixed-point': ['bet', 'milestone'] } },
  { field: 'next', kind: 'next', to: { bet: ['bet'] } },
  { field: 'assumptions', kind: 'assumption', to: { bet: ['assumption'], 'fixed-point': ['assumption'], milestone: ['assumption'] } },
];

/** The rule for a field. Throws on a field that is not in RELATIONS (a programming error). */
export function relationFor(field: string): RelationRule {
  const rule = RELATIONS.find((r) => r.field === field);
  if (!rule) throw new Error(`Not a relation field: ${field}`);
  return rule;
}

/** The types `holder` may link to through `rule`, or null when a `holder` cannot carry the field. */
export function targetsOf(rule: RelationRule, holder: NodeType): readonly NodeType[] | null {
  return rule.to[holder] ?? null;
}

/**
 * Whether "`holder` requires `prerequisite`" also means "`prerequisite` serves `holder`": a
 * prerequisite is done for what requires it. True when the relation table lets the prerequisite's
 * type serve the holder's (a bet serving a bet, milestone or fixed point; a milestone serving a
 * milestone or fixed point), false otherwise (a milestone can't serve a bet).
 */
export function requiresImpliesServes(holder: NodeType, prerequisite: NodeType): boolean {
  return targetsOf(relationFor('serves'), prerequisite)?.includes(holder) ?? false;
}

/**
 * Types that are known but are not graph nodes (D15): such notes are skipped like notes
 * without a type, instead of being reported as `unknown-type`.
 */
export const IGNORED_TYPES: readonly string[] = ['strategic-inbox'];

export function isIgnoredType(value: unknown): boolean {
  return typeof value === 'string' && IGNORED_TYPES.includes(value);
}

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

/** The status list for a type, or null when the type has no status. */
export function statusesFor(type: NodeType): readonly string[] | null {
  return (STATUSES as Partial<Record<NodeType, readonly string[]>>)[type] ?? null;
}

/**
 * What an adapter hands the core for one note. `resolvedLinks` maps every
 * wikilink path found in the frontmatter (as written, minus alias/heading) to
 * the vault path it resolves to, or null when it resolves to nothing.
 */
export interface NoteRecord {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
  resolvedLinks: Record<string, string | null>;
  /** Set by adapters that parse the YAML themselves, when it didn't parse. */
  frontmatterError?: string;
}

export interface GraphNode {
  /** Unique key: the note's `id`, or its path when the id is missing or duplicated. */
  key: string;
  /** The `id` frontmatter value; positions are keyed by it. Null when absent. */
  id: string | null;
  path: string;
  basename: string;
  type: NodeType;
  /** Null when the note has no status or the type carries none. */
  status: string | null;
  /** `deadline` (bets), as written. */
  deadline: string | null;
  /** `verify-by` (assumptions), as written. */
  verifyBy: string | null;
  frontmatter: Record<string, unknown>;
}

export interface GraphEdge {
  /** `${kind}:${from}>${to}`. */
  key: string;
  kind: EdgeKind;
  field: string;
  /** Node keys. */
  from: string;
  to: string;
  fromType: NodeType;
  toType: NodeType;
}

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'invalid-frontmatter'
  | 'unknown-type'
  | 'unknown-status'
  | 'missing-status'
  | 'missing-id'
  | 'duplicate-id'
  | 'invalid-date'
  | 'field-not-allowed'
  | 'malformed-link'
  | 'dangling-link'
  | 'non-strategy-target'
  | 'invalid-target-type'
  | 'self-link';

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  /** The note the issue was found in. */
  path: string;
  field?: string;
  message: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: Issue[];
}
