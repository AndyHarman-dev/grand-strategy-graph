import { readLinkField } from './links';
import {
  RELATIONS,
  isIgnoredType,
  isNodeType,
  statusesFor,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Issue,
  type IssueCode,
  type NodeType,
  type NoteRecord,
} from './schema';

const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/** A frontmatter scalar as trimmed text, or null when absent/empty. */
function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Derive nodes, edges and issues from note records. Never throws: anything the
 * schema doesn't allow becomes an issue and is left out of the graph.
 *
 * - Only notes with a `type` are strategy notes; notes without one, or with a known
 *   non-graph type (`IGNORED_TYPES`, D15), are skipped.
 * - Edge kind comes from the field name; the target's `type` decides whether
 *   the link is valid (see `RELATIONS`).
 * - Links are followed through `resolvedLinks`, never through filename prefixes.
 */
export function buildGraph(notes: readonly NoteRecord[]): Graph {
  const issues: Issue[] = [];
  const report = (code: IssueCode, severity: Issue['severity'], note: NoteRecord, message: string, field?: string) =>
    issues.push(field ? { code, severity, path: note.path, field, message } : { code, severity, path: note.path, message });

  // Pass 1: nodes.
  const sorted = [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const idCount = new Map<string, number>();
  for (const note of sorted) {
    const id = text(note.frontmatter.id);
    if (id && isNodeType(note.frontmatter.type)) idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [];
  const byPath = new Map<string, GraphNode>();
  for (const note of sorted) {
    if (note.frontmatterError) {
      report('invalid-frontmatter', 'error', note, `Frontmatter does not parse: ${note.frontmatterError}`);
      continue;
    }
    const type = note.frontmatter.type;
    if (type == null || type === '' || isIgnoredType(type)) continue;
    if (!isNodeType(type)) {
      report('unknown-type', 'error', note, `Unknown type "${String(type)}".`, 'type');
      continue;
    }

    const id = text(note.frontmatter.id);
    const duplicated = id !== null && (idCount.get(id) ?? 0) > 1;
    if (id === null) report('missing-id', 'error', note, 'Note has no `id`.', 'id');
    if (duplicated) report('duplicate-id', 'error', note, `Id "${id}" is used by more than one note.`, 'id');

    const status = text(note.frontmatter.status);
    const allowed = statusesFor(type);
    if (allowed) {
      if (status === null) report('missing-status', 'error', note, `A ${type} needs a status (${allowed.join(', ')}).`, 'status');
      else if (!allowed.includes(status)) {
        report('unknown-status', 'error', note, `Unknown ${type} status "${status}" (expected ${allowed.join(', ')}).`, 'status');
      }
    }

    const dates = { deadline: text(note.frontmatter.deadline), 'verify-by': text(note.frontmatter['verify-by']) };
    for (const [field, value] of Object.entries(dates)) {
      if (value !== null && !DATE.test(value)) report('invalid-date', 'warning', note, `"${value}" is not a date (YYYY-MM-DD).`, field);
    }

    const node: GraphNode = {
      key: id !== null && !duplicated ? id : note.path,
      id,
      path: note.path,
      basename: note.basename,
      type,
      status,
      deadline: dates.deadline,
      verifyBy: dates['verify-by'],
      frontmatter: note.frontmatter,
    };
    nodes.push(node);
    byPath.set(note.path, node);
  }

  // Pass 2: edges.
  const edges = new Map<string, GraphEdge>();
  for (const note of sorted) {
    const from = byPath.get(note.path);
    if (!from) continue;

    for (const rule of RELATIONS) {
      const { linkpaths, malformed } = readLinkField(note.frontmatter[rule.field]);
      if (!linkpaths.length && !malformed.length) continue;

      if (!rule.from.includes(from.type)) {
        report('field-not-allowed', 'warning', note, `A ${from.type} cannot have \`${rule.field}\`; ignored.`, rule.field);
        continue;
      }
      for (const value of malformed) {
        report('malformed-link', 'error', note, `\`${rule.field}\` has "${value}", which is not a [[link]].`, rule.field);
      }
      for (const linkpath of linkpaths) {
        const label = `[[${linkpath}]]`;
        const targetPath = note.resolvedLinks[linkpath] ?? null;
        if (targetPath === null) {
          report('dangling-link', 'error', note, `\`${rule.field}\` links to ${label}, which resolves to no note.`, rule.field);
          continue;
        }
        const to = byPath.get(targetPath);
        if (!to) {
          report('non-strategy-target', 'warning', note, `\`${rule.field}\` links to ${label} (${targetPath}), which is not a strategy note.`, rule.field);
          continue;
        }
        if (to === from) {
          report('self-link', 'error', note, `\`${rule.field}\` links the note to itself.`, rule.field);
          continue;
        }
        if (!(rule.to as readonly NodeType[]).includes(to.type)) {
          report('invalid-target-type', 'error', note, `\`${rule.field}\` cannot point at a ${to.type} (${label}).`, rule.field);
          continue;
        }
        const key = `${rule.kind}:${from.key}>${to.key}`;
        if (!edges.has(key)) {
          edges.set(key, { key, kind: rule.kind, field: rule.field, from: from.key, to: to.key, fromType: from.type, toType: to.type });
        }
      }
    }
  }

  return { nodes, edges: Array.from(edges.values()), issues };
}
