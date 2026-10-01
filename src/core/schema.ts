/**
 * Schema v2 as types and tables (plan decisions D2–D7, D13).
 * Pure data: no `obsidian` import, no behavior beyond lookups.
 */

export const NODE_TYPES = ['bet', 'assumption', 'fixed-point', 'route', 'milestone', 'current-position'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Allowed `status` values per type. Types without an entry (fixed points,
 * milestones, the current position) carry no status, so nothing is checked.
 */
export const STATUSES = {
  bet: ['active', 'dormant', 'won', 'killed', 'extended'],
  assumption: ['unverified', 'confirmed', 'falsified', 'undeterminable'],
  route: ['active', 'ghost'],
} as const satisfies Partial<Record<NodeType, readonly string[]>>;

export const EDGE_KINDS = ['serves', 'ultimately-serves', 'requires', 'next', 'assumption'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface RelationRule {
  /** Frontmatter field that holds the links. */
  field: string;
  kind: EdgeKind;
  /** Types that may carry the field. */
  from: readonly NodeType[];
  /** Types the links may point at. */
  to: readonly NodeType[];
}

/** One row per relationship field: which edge it makes, from whom, to what. */
export const RELATIONS: readonly RelationRule[] = [
  { field: 'serves', kind: 'serves', from: ['bet', 'route', 'milestone'], to: ['bet', 'route', 'milestone', 'fixed-point'] },
  { field: 'ultimately-serves', kind: 'ultimately-serves', from: ['bet'], to: ['fixed-point'] },
  { field: 'requires', kind: 'requires', from: ['bet'], to: ['bet'] },
  { field: 'next', kind: 'next', from: ['bet'], to: ['bet'] },
  { field: 'assumptions', kind: 'assumption', from: ['bet', 'fixed-point', 'route', 'milestone'], to: ['assumption'] },
];

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
