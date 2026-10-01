import type { GsMap } from '../../src/core/gsmap';
import type { NodeType } from '../../src/core/schema';

/** Where a legacy edge was found (plan Phase 2, oracle sources a–e). */
export type EdgeSource =
  | 'fm:serves'
  | 'fm:next sequel'
  | 'fm:next'
  | 'fm:requires'
  | 'fm:assumptions'
  | 'fm:ultimately-serves'
  | 'body:serves'
  | 'body:assumptions'
  | 'body:depended-on-by'
  | 'canvas';

/** One row of `legacy-edges.json`: an edge exactly as the legacy data states it. */
export interface LegacyEdge {
  /** Unique and stable while the vault doesn't change. */
  id: string;
  source: EdgeSource;
  /** Path of the note holding the link. Canvas: the from-node (`file` path, or `card:<id>` / `group:<id>`). */
  from: string;
  /** The value as written (`[[…]]`, or a non-link frontmatter value). Canvas: the to-node, like `from`. */
  to: string;
  /** Vault path `to` resolves to; null when it is malformed, dangling, or not a file. */
  toPath: string | null;
  /** Canvas edge label. */
  label: string | null;
  /** 1-based line in the note's body (body links only). */
  line?: number;
}

/** v2 relation fields the migration writes. */
export type RelField = 'serves' | 'ultimately-serves' | 'requires' | 'next' | 'assumptions';

export type Fate =
  /** Present in the planned output as `field` on `holder` pointing at `target` (paths). */
  | { kind: 'written'; field: RelField; holder: string; target: string; how: string }
  /** Left in the frontmatter as it is and listed (D13: links to a non-strategy note). */
  | { kind: 'kept'; reason: string }
  | { kind: 'dropped'; reason: string }
  /** Became a free link in the `.gsmap` (anything touching a card, or a kept annotation). */
  | { kind: 'gsmap-link'; link: string; reason: string }
  /** Waiting for an answer in resolutions.yaml; not written. */
  | { kind: 'open'; ambiguity: string }
  /** No classification rule covers it: a new decision for the user (plan: escalate/stop). */
  | { kind: 'unclassified'; reason: string };

export interface ClassifiedEdge {
  edge: LegacyEdge;
  fate: Fate;
}

export type AmbiguityKind = 'link' | 'canvas-edge' | 'junction' | 'id' | 'status' | 'section';

export interface Ambiguity {
  /** Key in resolutions.yaml. */
  key: string;
  kind: AmbiguityKind;
  path?: string;
  question: string;
  /** Accepted answers, as the user would type them. */
  options: string[];
  /** The answer from resolutions.yaml, if any. */
  answer?: unknown;
  /** Why the answer was rejected. */
  error?: string;
  resolved: boolean;
}

export interface FileChange {
  path: string;
  /** Null for a new file. */
  before: string | null;
  after: string;
  summary: string[];
}

export interface Finding {
  severity: 'blocker' | 'warning' | 'info';
  path?: string;
  message: string;
}

export interface PlannedNote {
  path: string;
  type: NodeType;
  id: string | null;
}

export interface MigrationPlan {
  oracle: LegacyEdge[];
  edges: ClassifiedEdge[];
  ambiguities: Ambiguity[];
  /** Resolutions given for keys this run never asked about. */
  staleResolutions: string[];
  changes: FileChange[];
  /** Relations written by a resolution that no single legacy edge states (the "AND" junction). */
  derived: { field: RelField; holder: string; target: string; why: string }[];
  gsmap: GsMap;
  /** Every canvas node id and where it went (`position:<id>`, `card:<id>`, `frame:<id>`). */
  canvasNodes: { node: string; placed: string | null }[];
  notes: PlannedNote[];
  findings: Finding[];
}

export interface MigrationOptions {
  /** Folder holding the strategy notes. */
  strategyRoot?: string;
  templatesFolder?: string;
  canvasPath?: string;
  gsmapPath?: string;
  /** Answers keyed like `Ambiguity.key`. */
  resolutions?: Record<string, unknown>;
}
