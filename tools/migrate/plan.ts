/**
 * Migration planner (plan Phase 2): legacy notes + `The Map.canvas` → schema v2 notes and
 * `Strategy.gsmap`. Pure: takes the vault as path → text and returns what it would write.
 * Nothing here touches a disk; `tools/migrate.ts` is the CLI around it.
 *
 * Every legacy edge is captured first (the oracle), then given exactly one fate by the
 * classification rules. Anything the rules don't cover is `unclassified` and stops the
 * migration: that is a new decision for the user, not something to guess in code.
 */
import type { Document, Pair } from 'yaml';
import { dependedOnByBlock } from '../../src/core/content';
import { emptyGsMap, GSMAP_PATH, serializeGsMap, type GsEndpoint, type GsLink, type GsMap, type GsSide } from '../../src/core/gsmap';
import { parseIds } from '../../src/core/ids';
import { linkpathOf, resolveLinkpath } from '../../src/core/links';
import { STRATEGY_ROOT } from '../../src/core/memory-adapter';
import { isIgnoredType, isNodeType, RELATIONS, statusesFor, type NodeType } from '../../src/core/schema';
import { eolOf, joinNote, sameHeading, sections, splitNote, type SplitNote } from './markdown';
import type {
  Ambiguity,
  AmbiguityKind,
  ClassifiedEdge,
  EdgeSource,
  Fate,
  FileChange,
  Finding,
  LegacyEdge,
  MigrationOptions,
  MigrationPlan,
  PlannedNote,
  RelField,
} from './types';
import {
  emptyValue,
  findPair,
  insertPair,
  pairIndex,
  parseYaml,
  quoted,
  removePair,
  renameKey,
  setList,
  setScalar,
  stringifyYaml,
  valueNodes,
} from './yaml-edit';

export const SERVES_HEADING = 'Serves';
export const BET_ASSUMPTIONS_HEADING = 'Assumptions This Bet Depends On';
export const DEPENDED_ON_BY_HEADING = 'Depended On By';
export const CURRENT_POSITION_ID = 'CP';
export const DEFAULT_TEMPLATES_FOLDER = 'Templates';
export const DEFAULT_CANVAS_PATH = 'Strategy/The Map.canvas';

/** Statuses renamed by D6. Every other v2 status passes through; anything else is asked. */
export const STATUS_RENAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  bet: { asleep: 'dormant', cancelled: 'killed' },
};

/** Template placeholder lines in the managed sections (legacy content builders). Safe to drop. */
const BOILERPLATE = new Set([
  'Which fixed point / direction does this bet serve?',
  '*Check linked mentions — every bet and decision that leans on this. When status flips to `falsified`, everything listed there needs re-examination at the next weekly review.*',
]);

/** The relation fields read from legacy frontmatter, in the order they are processed. */
const FM_FIELDS: readonly { key: string; field: RelField }[] = [
  { key: 'serves', field: 'serves' },
  { key: 'ultimately-serves', field: 'ultimately-serves' },
  { key: 'requires', field: 'requires' },
  { key: 'next', field: 'next' },
  { key: 'next sequel', field: 'next' },
  { key: 'assumptions', field: 'assumptions' },
];

/** Schema order of the relation keys; a new key goes after the nearest one before it that the note has. */
const RELATION_ORDER: readonly string[][] = [['serves'], ['ultimately-serves'], ['requires'], ['next', 'next sequel'], ['assumptions']];

/** Index for a new relation key: after the closest earlier relation key, else before the closest later one, else last. */
function insertionIndex(doc: Document, key: string): number {
  const rank = RELATION_ORDER.findIndex((keys) => keys.includes(key));
  for (let r = rank - 1; r >= 0; r--) {
    const at = Math.max(...RELATION_ORDER[r].map((k) => pairIndex(doc, k)));
    if (at !== -1) return at + 1;
  }
  for (let r = rank + 1; r < RELATION_ORDER.length; r++) {
    const found = RELATION_ORDER[r].map((k) => pairIndex(doc, k)).filter((i) => i !== -1);
    if (found.length) return Math.min(...found);
  }
  return Number.MAX_SAFE_INTEGER;
}

const SOURCE_LABEL: Record<EdgeSource, string> = {
  'fm:serves': 'frontmatter `serves`',
  'fm:next sequel': 'frontmatter `next sequel`',
  'fm:next': 'frontmatter `next`',
  'fm:requires': 'frontmatter `requires`',
  'fm:assumptions': 'frontmatter `assumptions`',
  'fm:ultimately-serves': 'frontmatter `ultimately-serves`',
  'body:serves': '`## Serves`',
  'body:assumptions': '`## Assumptions This Bet Depends On`',
  'body:depended-on-by': '`## Depended On By`',
  canvas: 'the canvas',
};

const WIKILINK = /!?\[\[([^\]]*)\]\]/g;
const PURE_LINK_LINE = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?(?:!?\[\[[^\]]*\]\][\s,;]*)+$/;

interface Note {
  path: string;
  basename: string;
  content: string;
  split: SplitNote;
  doc: Document | null;
  data: Record<string, unknown>;
  /** Why the frontmatter can't be edited (the note is then never rewritten). */
  yamlError?: string;
  /** v2 type; null for notes that are not strategy notes. */
  type: NodeType | null;
  template: boolean;
  id: string | null;
}

type Target =
  | { kind: 'malformed'; why: string }
  | { kind: 'dangling' }
  | { kind: 'self' }
  | { kind: 'note'; path: string; type: NodeType | null };

interface Entry {
  /** The YAML node of a frontmatter entry (null for an added one). */
  node: unknown;
  text: string;
  path: string | null;
  keep: boolean;
  /** Replacement text from a `retarget` answer. */
  replace?: string;
}

interface FieldPlan {
  field: RelField;
  /** Legacy keys this field was read from (`next` and/or `next sequel`). */
  keys: string[];
  entries: Entry[];
  added: { text: string; path: string }[];
  wasScalar: boolean;
}

interface SectionPlan {
  heading: string;
  action: 'remove' | 'replace' | 'keep';
  start: number;
  end: number;
}

/** `a bet`, `an assumption`. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;
const basenameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const sortPaths = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function planMigration(files: Readonly<Record<string, string>>, options: MigrationOptions = {}): MigrationPlan {
  const root = (options.strategyRoot ?? STRATEGY_ROOT).replace(/\/+$/, '');
  const templatesFolder = (options.templatesFolder ?? DEFAULT_TEMPLATES_FOLDER).replace(/\/+$/, '');
  const canvasPath = options.canvasPath ?? DEFAULT_CANVAS_PATH;
  const gsmapPath = options.gsmapPath ?? GSMAP_PATH;
  const resolutions = options.resolutions ?? {};

  const allPaths = Object.keys(files).sort(sortPaths);
  const mdPaths = allPaths.filter((p) => p.endsWith('.md'));
  const findings: Finding[] = [];
  const edges: ClassifiedEdge[] = [];
  const ambiguities = new Map<string, Ambiguity>();
  const derived: { field: RelField; holder: string; target: string; why: string }[] = [];

  // ---------------------------------------------------------------- notes
  const notes = new Map<string, Note>();
  const currentPositionPath = `${root}/Current Position.md`;
  for (const path of mdPaths) {
    const inRoot = path.startsWith(root + '/');
    const inTemplates = path.startsWith(templatesFolder + '/');
    if (!inRoot && !inTemplates) continue;
    const content = files[path];
    const split = splitNote(content);
    const parsed = split.yaml === null ? parseYaml('') : parseYaml(split.yaml);
    const legacyType = parsed.data.type;
    let type: NodeType | null = null;
    let template = false;
    if (inRoot) {
      if (isNodeType(legacyType)) type = legacyType;
      else if (path === currentPositionPath && (legacyType == null || legacyType === '')) type = 'current-position';
      else if (isIgnoredType(legacyType)) {
        findings.push({ severity: 'info', path, message: `Type "${String(legacyType)}" is not a graph node (D15): left untouched.` });
      } else if (legacyType != null && legacyType !== '') {
        findings.push({ severity: 'warning', path, message: `Unknown type "${String(legacyType)}": not a strategy note, left untouched.` });
      } else if (parsed.error && split.yaml !== null) {
        findings.push({ severity: 'blocker', path, message: `Frontmatter can't be read (${parsed.error}), so its type and links are unknown.` });
      }
    } else if (legacyType === 'bet' || legacyType === 'assumption') {
      template = true;
    }
    if (!type && !template) continue;
    const note: Note = { path, basename: basenameOf(path), content, split, doc: parsed.doc, data: parsed.data, type, template, id: null };
    if (parsed.error) {
      note.yamlError = parsed.error;
      findings.push({ severity: 'blocker', path, message: `Frontmatter can't be edited safely: ${parsed.error}. The note is left untouched.` });
    }
    notes.set(path, note);
  }
  const strategy = [...notes.values()].filter((n) => n.type !== null);
  const typeOf = (path: string) => notes.get(path)?.type ?? null;

  // ---------------------------------------------------------------- ambiguities
  const ask = (key: string, kind: AmbiguityKind, path: string | undefined, question: string, opts: string[]): Ambiguity => {
    let a = ambiguities.get(key);
    if (!a) {
      a = { key, kind, question, options: opts, resolved: false };
      if (path) a.path = path;
      if (Object.prototype.hasOwnProperty.call(resolutions, key) && resolutions[key] != null) a.answer = resolutions[key];
      ambiguities.set(key, a);
    }
    return a;
  };
  const reject = (a: Ambiguity, error: string) => {
    a.resolved = false;
    a.error = error;
  };
  const accept = (a: Ambiguity) => {
    if (!a.error) a.resolved = true;
  };
  const answerWord = (a: Ambiguity): string | null => (typeof a.answer === 'string' ? a.answer.trim().toLowerCase() : null);
  const answerField = (a: Ambiguity, field: string): unknown =>
    a.answer && typeof a.answer === 'object' && !Array.isArray(a.answer) ? (a.answer as Record<string, unknown>)[field] : undefined;

  // ---------------------------------------------------------------- ids
  {
    const byPrefix = new Map<string, Note[]>();
    for (const note of strategy) {
      const explicit = note.data.id == null ? '' : String(note.data.id).trim();
      if (explicit) {
        note.id = explicit;
        continue;
      }
      if (note.type === 'current-position') {
        note.id = CURRENT_POSITION_ID;
        continue;
      }
      const m = /^([A-Za-z]+)-\d+/.exec(note.basename);
      if (!m) continue;
      const prefix = m[1].toUpperCase();
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), note]);
    }
    for (const [prefix, group] of byPrefix) {
      // Same rule as the creation flows: anchored, digit-greedy, duplicates refused.
      const parsed = parseIds(group.map((n) => n.basename.replace(/^[A-Za-z]+/, prefix)), prefix);
      for (const note of group) {
        const n = Number.parseInt(/^[A-Za-z]+-(\d+)/.exec(note.basename)![1], 10);
        if (!parsed.duplicates.includes(n) && Number.isSafeInteger(n)) note.id = `${prefix}-${n}`;
      }
    }
    const counts = new Map<string, number>();
    for (const note of strategy) if (note.id) counts.set(note.id, (counts.get(note.id) ?? 0) + 1);
    for (const note of strategy) {
      const parsedId = /^([A-Za-z]+)-(\d+)/.exec(note.basename);
      const problem = !note.id
        ? parsedId
          ? `${note.basename}: its id ${parsedId[1].toUpperCase()}-${Number(parsedId[2])} is also parsed from another note's name`
          : `${note.basename}: no id can be parsed from the name`
        : (counts.get(note.id) ?? 0) > 1
          ? `${note.basename}: id "${note.id}" is used by more than one note`
          : null;
      if (!problem) continue;
      const a = ask(`id: ${note.path}`, 'id', note.path, `${problem}. Which id should it get?`, ['{ id: "B-12" }']);
      note.id = null;
      if (a.answer === undefined) continue;
      const given = typeof a.answer === 'string' ? a.answer : answerField(a, 'id');
      if (typeof given === 'string' && given.trim()) {
        note.id = given.trim();
        accept(a);
      } else reject(a, 'expected { id: "<id>" }');
    }
    // Answers can collide with each other or with parsed ids.
    const final = new Map<string, Note[]>();
    for (const note of strategy) if (note.id) final.set(note.id, [...(final.get(note.id) ?? []), note]);
    for (const [id, group] of final) {
      if (group.length < 2) continue;
      for (const note of group) {
        const a = ambiguities.get(`id: ${note.path}`);
        if (a?.resolved) {
          reject(a, `id "${id}" is still used by ${group.length} notes`);
          note.id = null;
        }
      }
    }
  }

  // ---------------------------------------------------------------- statuses
  const newStatus = new Map<string, string>();
  for (const note of strategy) {
    const allowed = statusesFor(note.type!);
    const raw = note.data.status;
    if (!allowed || raw == null || raw === '') {
      if (allowed) findings.push({ severity: 'warning', path: note.path, message: `No status (${article(note.type!)} needs one of ${allowed.join(', ')}). Left empty.` });
      continue;
    }
    const status = String(raw).trim();
    const renamed = STATUS_RENAMES[note.type!]?.[status];
    if (renamed) {
      newStatus.set(note.path, renamed);
      continue;
    }
    if (typeof raw === 'string' && allowed.includes(status)) continue;
    const a = ask(`status: ${note.path}`, 'status', note.path, `${note.basename}: unknown ${note.type} status "${status}". Which v2 status is it?`, [
      `{ status: ${allowed.join(' | ')} }`,
    ]);
    if (a.answer === undefined) continue;
    const given = typeof a.answer === 'string' ? a.answer : answerField(a, 'status');
    if (typeof given === 'string' && allowed.includes(given.trim())) {
      newStatus.set(note.path, given.trim());
      accept(a);
    } else reject(a, `expected one of ${allowed.join(', ')}`);
  }

  // ---------------------------------------------------------------- links
  const linkTo = (path: string): string => {
    const base = basenameOf(path);
    const same = mdPaths.filter((p) => basenameOf(p).toLowerCase() === base.toLowerCase());
    return `[[${same.length === 1 ? base : path.replace(/\.md$/, '')}]]`;
  };
  const inspectInner = (inner: string, fromPath: string): Target => {
    const linkpath = linkpathOf(inner);
    if (!linkpath || /^[.\s…_-]*$/.test(linkpath)) return { kind: 'malformed', why: 'placeholder link' };
    if (/^[A-Za-z]+-\s*$/.test(linkpath)) return { kind: 'malformed', why: 'id prefix with no number' };
    const path = resolveLinkpath(linkpath, fromPath, allPaths);
    if (!path) return { kind: 'dangling' };
    if (path === fromPath) return { kind: 'self' };
    return { kind: 'note', path, type: typeOf(path) };
  };
  const inspectValue = (raw: unknown, fromPath: string): Target => {
    if (typeof raw !== 'string') return { kind: 'malformed', why: 'not a [[link]]' };
    const links = Array.from(raw.matchAll(WIKILINK));
    if (!links.length) return { kind: 'malformed', why: 'not a [[link]]' };
    if (links.length > 1) return { kind: 'malformed', why: 'several links in one value' };
    return inspectInner(links[0][1], fromPath);
  };
  const problemOf = (t: Target) =>
    t.kind === 'malformed' ? `malformed (${t.why})` : t.kind === 'dangling' ? 'dangling (resolves to no note)' : t.kind === 'self' ? 'a self-loop' : '';

  const ruleFor = (field: RelField) => RELATIONS.find((r) => r.field === field)!;
  const allowed = (field: RelField, holder: NodeType | null, target: NodeType | null) =>
    holder !== null && target !== null && ruleFor(field).from.includes(holder) && (ruleFor(field).to as readonly NodeType[]).includes(target);

  // ---------------------------------------------------------------- field plans
  const fieldPlans = new Map<string, Map<RelField, FieldPlan>>();
  const fieldPlan = (path: string, field: RelField): FieldPlan => {
    let byField = fieldPlans.get(path);
    if (!byField) fieldPlans.set(path, (byField = new Map()));
    let plan = byField.get(field);
    if (!plan) byField.set(field, (plan = { field, keys: [], entries: [], added: [], wasScalar: false }));
    return plan;
  };
  const targets = (plan: FieldPlan) => [
    ...plan.entries.filter((e) => e.keep && e.path).map((e) => e.path!),
    ...plan.added.map((a) => a.path),
  ];
  const has = (holder: string, field: RelField, target: string) => {
    const plan = fieldPlans.get(holder)?.get(field);
    return !!plan && targets(plan).includes(target);
  };
  /** Add a relation; a target that is already there is left alone (forward/reverse lists are unioned). */
  const addRelation = (holder: string, field: RelField, text: string, target: string) => {
    if (!has(holder, field, target)) fieldPlan(holder, field).added.push({ text, path: target });
  };

  const edgeSeq = new Map<string, number>();
  /** Ids are `source|from|n` (canvas: `canvas|<edge id>`), so they don't shift when other notes change. */
  const record = (edge: Omit<LegacyEdge, 'id'> & { canvasId?: string }, fate: Fate): ClassifiedEdge => {
    const { canvasId, ...rest } = edge;
    const scope = `${rest.source}|${rest.from}`;
    edgeSeq.set(scope, (edgeSeq.get(scope) ?? 0) + 1);
    const id = canvasId !== undefined ? `canvas|${canvasId}` : `${scope}|${edgeSeq.get(scope)}`;
    const classified = { edge: { id, ...rest }, fate };
    edges.push(classified);
    return classified;
  };
  const open = (a: Ambiguity): Fate => ({ kind: 'open', ambiguity: a.key });

  /**
   * A malformed, dangling or self link: ask whether to drop or retarget it. Returns the
   * new target when retargeted to something `check` accepts, `drop`, or `open`.
   */
  const askLink = (
    note: Note,
    source: EdgeSource,
    raw: string,
    t: Target,
    check: (target: Target & { kind: 'note' }) => string | null
  ): { kind: 'retarget'; text: string; target: Target & { kind: 'note' } } | { kind: 'drop' } | { kind: 'open'; a: Ambiguity } => {
    const a = ask(`link: ${note.basename} / ${source} / ${raw}`, 'link', note.path, `${note.basename}: ${SOURCE_LABEL[source]} has ${raw}, which is ${problemOf(t)}.`, [
      'drop',
      '{ retarget: "[[<note>]]" }',
    ]);
    if (a.answer === undefined) return { kind: 'open', a };
    if (answerWord(a) === 'drop') {
      accept(a);
      return { kind: 'drop' };
    }
    const text = answerField(a, 'retarget');
    if (typeof text !== 'string') {
      reject(a, 'expected drop or { retarget: "[[<note>]]" }');
      return { kind: 'open', a };
    }
    const nt = inspectValue(text, note.path);
    if (nt.kind !== 'note') {
      reject(a, `${text} is ${problemOf(nt)}`);
      return { kind: 'open', a };
    }
    const problem = check(nt);
    if (problem) {
      reject(a, problem);
      return { kind: 'open', a };
    }
    accept(a);
    return { kind: 'retarget', text: text.trim(), target: nt };
  };

  // (a) frontmatter relation fields
  for (const note of strategy) {
    for (const { key, field } of FM_FIELDS) {
      if (!(key in note.data)) continue;
      const plan = fieldPlan(note.path, field);
      plan.keys.push(key);
      const pair = note.doc ? findPair(note.doc, key) : undefined;
      const nodes = pair ? valueNodes(pair) : [];
      const raw = note.data[key];
      const values = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
      if (!Array.isArray(raw) && values.length) plan.wasScalar = true;
      values.forEach((value, i) => {
        const source = `fm:${key}` as EdgeSource;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        const t = inspectValue(value, note.path);
        const entry: Entry = { node: nodes[i] ?? null, text, path: t.kind === 'note' ? t.path : null, keep: true };
        plan.entries.push(entry);
        if (value == null || value === '') return; // an empty list item: kept, not an edge
        const base = { source, from: note.path, to: text, toPath: entry.path, label: null };
        if (t.kind === 'note') {
          if (t.type === null && field === 'serves') {
            record(base, { kind: 'kept', reason: `links to ${t.path}, which is not a strategy note; kept as is (D13)` });
          } else if (allowed(field, note.type, t.type)) {
            record(base, { kind: 'written', field, holder: note.path, target: t.path, how: key === field ? 'kept' : `\`${key}\` renamed to \`${field}\`` });
          } else {
            const what = t.type ? article(t.type) : 'a non-strategy note';
            record(base, { kind: 'unclassified', reason: `${article(note.type!)} with \`${key}\` pointing at ${what}: no rule covers it` });
          }
          return;
        }
        const answer = askLink(note, source, text, t, (nt) =>
          allowed(field, note.type, nt.type) ? null : `\`${field}\` on ${article(note.type!)} can't point at ${nt.type ? article(nt.type) : 'a non-strategy note'}`
        );
        if (answer.kind === 'open') {
          entry.keep = false;
          record(base, open(answer.a));
        } else if (answer.kind === 'drop') {
          entry.keep = false;
          record(base, { kind: 'dropped', reason: `${problemOf(t)}; dropped (resolution)` });
        } else {
          entry.replace = answer.text;
          entry.path = answer.target.path;
          record(base, { kind: 'written', field, holder: note.path, target: answer.target.path, how: `retargeted to ${answer.text} (resolution)` });
        }
      });
    }
  }

  // Body sections
  const sectionPlans = new Map<string, SectionPlan[]>();
  const bodyLines = (note: Note) => note.split.body.split('\n');
  /** 1-based line of body line `i` in the whole file. */
  const fileLine = (note: Note, i: number) => note.content.slice(0, note.content.length - note.split.body.length).split('\n').length + i;

  const readSection = (note: Note, heading: string, action: 'remove' | 'replace') => {
    const lines = bodyLines(note);
    const found: { inner: string; line: number }[] = [];
    for (const s of sections(lines)) {
      if (s.level !== 2 || !sameHeading(s.heading, heading)) continue;
      const content = lines.slice(s.start + 1, s.end).map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
      if (action === 'replace' && content.join('\n') === dependedOnByBlock(root).join('\n')) continue; // already migrated
      const prose: string[] = [];
      for (let i = s.start + 1; i < s.end; i++) {
        const line = lines[i].replace(/\r$/, '');
        for (const m of line.matchAll(WIKILINK)) found.push({ inner: m[1], line: fileLine(note, i) });
        if (line.trim() && !BOILERPLATE.has(line.trim()) && !PURE_LINK_LINE.test(line)) prose.push(line.trim());
      }
      let act: SectionPlan['action'] = action;
      if (prose.length) {
        const a = ask(
          `section: ${note.path} / ${s.heading}`,
          'section',
          note.path,
          `${note.basename}: \`## ${s.heading}\` has text besides links, which ${action === 'remove' ? 'removing the section' : 'the Dataview block'} would delete: ${prose.map((p) => JSON.stringify(p)).join(', ')}.`,
          ['remove', 'keep']
        );
        const word = answerWord(a);
        if (word === 'remove') accept(a);
        else if (word === 'keep') {
          accept(a);
          act = 'keep';
        } else {
          if (a.answer !== undefined) reject(a, 'expected remove or keep');
          act = 'keep'; // never delete text nobody agreed to delete
        }
      }
      sectionPlans.set(note.path, [...(sectionPlans.get(note.path) ?? []), { heading: s.heading!, action: act, start: s.start, end: s.end }]);
    }
    return found;
  };

  const MANAGED = [SERVES_HEADING, BET_ASSUMPTIONS_HEADING, DEPENDED_ON_BY_HEADING];
  // Bets first, so a bet's own list keeps its order and reverse-only entries come after it.
  const betsFirst = (n: Note) => ((n.template ? n.data.type : n.type) === 'bet' ? 0 : 1);
  for (const note of [...notes.values()].sort((a, b) => betsFirst(a) - betsFirst(b) || sortPaths(a.path, b.path))) {
    if (note.yamlError) continue;
    const kind = note.template ? note.data.type : note.type;
    if (kind !== 'bet' && kind !== 'assumption') {
      const lines = bodyLines(note);
      const stray = sections(lines).filter((s) => s.level === 2 && MANAGED.some((h) => sameHeading(s.heading, h)));
      for (const s of stray) {
        findings.push({ severity: 'warning', path: note.path, message: `${article(String(kind))} with a \`## ${s.heading}\` section: not read, left as is.` });
      }
      continue;
    }

    if (kind === 'bet') {
      // (b) body ## Serves: the section is dropped (D12); its links are only accounted for.
      for (const { inner, line } of readSection(note, SERVES_HEADING, 'remove')) {
        if (note.template) continue;
        const raw = `[[${inner}]]`;
        const t = inspectInner(inner, note.path);
        const base = { source: 'body:serves' as const, from: note.path, to: raw, toPath: t.kind === 'note' ? t.path : null, label: null, line };
        // A non-strategy target first: `has` also counts frontmatter links kept as is (D13),
        // which make no graph edge, so they must not be classified as `written`.
        if (t.kind === 'note' && t.type === null && fieldPlans.get(note.path)?.get('serves')?.entries.some((e) => e.keep && e.path === t.path)) {
          record(base, { kind: 'kept', reason: 'also in frontmatter `serves`, kept there as is (D13); body section dropped' });
        } else if (t.kind === 'note' && has(note.path, 'serves', t.path)) {
          record(base, { kind: 'written', field: 'serves', holder: note.path, target: t.path, how: 'also in frontmatter `serves`; body section dropped' });
        } else {
          const why = t.kind === 'note' ? 'body-only link' : `body-only link, ${problemOf(t)}`;
          record(base, { kind: 'dropped', reason: `${why}; \`## Serves\` is dropped without merging (D12)` });
        }
      }

      // (c) body ## Assumptions This Bet Depends On → `assumptions` / `requires`
      for (const { inner, line } of readSection(note, BET_ASSUMPTIONS_HEADING, 'remove')) {
        if (note.template) continue;
        const raw = `[[${inner}]]`;
        const t = inspectInner(inner, note.path);
        const base = { source: 'body:assumptions' as const, from: note.path, to: raw, toPath: t.kind === 'note' ? t.path : null, label: null, line };
        const fieldFor = (type: NodeType | null): RelField | null => (type === 'assumption' ? 'assumptions' : type === 'bet' ? 'requires' : null);
        const write = (text: string, target: Target & { kind: 'note' }, how: string) => {
          const field = fieldFor(target.type)!;
          addRelation(note.path, field, text, target.path);
          record(base, { kind: 'written', field, holder: note.path, target: target.path, how });
        };
        if (t.kind === 'note') {
          const field = fieldFor(t.type);
          if (field && allowed(field, note.type, t.type)) write(raw, t, t.type === 'bet' ? 'bet listed as an assumption → `requires` (D7)' : 'forward list');
          else record(base, { kind: 'unclassified', reason: `an assumption-list link to ${t.type ? article(t.type) : 'a non-strategy note'}: no rule covers it` });
          continue;
        }
        const answer = askLink(note, 'body:assumptions', raw, t, (nt) => {
          const field = fieldFor(nt.type);
          return field && allowed(field, note.type, nt.type) ? null : 'must be an assumption or a bet';
        });
        if (answer.kind === 'open') record(base, open(answer.a));
        else if (answer.kind === 'drop') record(base, { kind: 'dropped', reason: `${problemOf(t)}; dropped (resolution)` });
        else write(answer.text, answer.target, `retargeted to ${answer.text} (resolution)`);
      }
    } else {
      // (d) assumption ## Depended On By → `assumptions` on each dependent (unioned)
      const found = readSection(note, DEPENDED_ON_BY_HEADING, 'replace');
      if (!note.template && !(sectionPlans.get(note.path) ?? []).length) {
        findings.push({ severity: 'info', path: note.path, message: 'No `## Depended On By` section; no Dataview block added.' });
      }
      for (const { inner, line } of found) {
        if (note.template) continue;
        const raw = `[[${inner}]]`;
        const t = inspectInner(inner, note.path);
        const base = { source: 'body:depended-on-by' as const, from: note.path, to: raw, toPath: t.kind === 'note' ? t.path : null, label: null, line };
        const write = (dependent: string, how: string) => {
          addRelation(dependent, 'assumptions', linkTo(note.path), note.path);
          record(base, { kind: 'written', field: 'assumptions', holder: dependent, target: note.path, how });
        };
        if (t.kind === 'note') {
          if (allowed('assumptions', t.type, 'assumption')) write(t.path, t.type === 'bet' ? 'reverse list' : `reverse list; ${article(t.type!)} carries \`assumptions\` (D7)`);
          else record(base, { kind: 'unclassified', reason: `depended on by ${t.type ? article(t.type) : 'a non-strategy note'}: no rule covers it` });
          continue;
        }
        const answer = askLink(note, 'body:depended-on-by', raw, t, (nt) =>
          allowed('assumptions', nt.type, 'assumption') ? null : 'must be a bet, fixed point, route or milestone'
        );
        if (answer.kind === 'open') record(base, open(answer.a));
        else if (answer.kind === 'drop') record(base, { kind: 'dropped', reason: `${problemOf(t)}; dropped (resolution)` });
        else write(answer.target.path, `retargeted to ${answer.text} (resolution)`);
      }
    }
  }

  // ---------------------------------------------------------------- canvas (e)
  const gsmap: GsMap = emptyGsMap();
  const canvasNodes: { node: string; placed: string | null }[] = [];
  const canvasText = files[canvasPath];
  if (canvasText !== undefined) {
    planCanvas(canvasText);
  } else {
    findings.push({ severity: 'info', message: `No canvas at ${canvasPath}; the .gsmap starts empty.` });
  }

  function planCanvas(text: string) {
    let canvas: { nodes?: unknown; edges?: unknown };
    try {
      canvas = JSON.parse(text) as typeof canvas;
    } catch (e) {
      findings.push({ severity: 'blocker', path: canvasPath, message: `Canvas is not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const cNodes = (Array.isArray(canvas.nodes) ? canvas.nodes : []) as Record<string, unknown>[];
    const cEdges = (Array.isArray(canvas.edges) ? canvas.edges : []) as Record<string, unknown>[];

    type Info = { kind: 'note'; note: Note; endpoint: string } | { kind: 'card'; endpoint: string } | { kind: 'frame'; endpoint: string } | { kind: 'unknown'; endpoint: string };
    const info = new Map<string, Info>();
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
    const style = (v: unknown) => {
      if (!v || typeof v !== 'object') return undefined;
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string' && x !== '') as [string, string][];
      return entries.length ? Object.fromEntries(entries) : undefined;
    };
    const rect = (n: Record<string, unknown>) => {
      const r: { x: number; y: number; width: number; height: number; color?: string; style?: Record<string, string> } = {
        x: num(n.x), y: num(n.y), width: num(n.width), height: num(n.height),
      };
      const color = str(n.color);
      const st = style(n.styleAttributes);
      if (color) r.color = color;
      if (st) r.style = st;
      return r;
    };
    const filePath = (file: string) => (file in files ? file : allPaths.find((p) => p.toLowerCase() === file.toLowerCase()) ?? null);

    for (const n of cNodes) {
      const id = String(n.id);
      const nodeType = n.type;
      if (nodeType === 'file' && typeof n.file === 'string') {
        const path = filePath(n.file);
        const note = path ? notes.get(path) : undefined;
        if (note?.type) {
          const key = note.id ?? note.path;
          if (!(key in gsmap.positions)) {
            gsmap.positions[key] = { x: num(n.x), y: num(n.y) };
            info.set(id, { kind: 'note', note, endpoint: note.path });
            canvasNodes.push({ node: id, placed: `position:${key}` });
            continue;
          }
          findings.push({ severity: 'warning', path: canvasPath, message: `${note.basename} is on the canvas twice; the second node (${id}) becomes a note-reference card.` });
        }
        if (!path) findings.push({ severity: 'warning', path: canvasPath, message: `Canvas node ${id} points at ${n.file}, which doesn't exist; kept as a note-reference card.` });
        gsmap.cards.push({ id, kind: 'note-ref', file: path ?? n.file, ...rect(n) });
        info.set(id, { kind: 'card', endpoint: path ?? n.file });
        canvasNodes.push({ node: id, placed: `card:${id}` });
      } else if (nodeType === 'text') {
        gsmap.cards.push({ id, kind: 'text', text: typeof n.text === 'string' ? n.text : '', ...rect(n) });
        info.set(id, { kind: 'card', endpoint: `card:${id}` });
        canvasNodes.push({ node: id, placed: `card:${id}` });
      } else if (nodeType === 'link' && typeof n.url === 'string') {
        gsmap.cards.push({ id, kind: 'link', url: n.url, ...rect(n) });
        info.set(id, { kind: 'card', endpoint: `card:${id}` });
        canvasNodes.push({ node: id, placed: `card:${id}` });
      } else if (nodeType === 'group') {
        gsmap.frames.push({ id, label: typeof n.label === 'string' ? n.label : '', ...rect(n) });
        info.set(id, { kind: 'frame', endpoint: `group:${id}` });
        canvasNodes.push({ node: id, placed: `frame:${id}` });
      } else {
        findings.push({ severity: 'blocker', path: canvasPath, message: `Canvas node ${id} has type "${String(nodeType)}", which no rule covers.` });
        info.set(id, { kind: 'unknown', endpoint: `${String(nodeType)}:${id}` });
        canvasNodes.push({ node: id, placed: null });
      }
    }

    const endpointFor = (i: Info): GsEndpoint => (i.kind === 'note' ? { note: i.note.id ?? i.note.path } : { card: i.endpoint.replace(/^card:/, '') });
    const cardEndpoint = (nodeId: string, i: Info): GsEndpoint => (i.kind === 'note' ? endpointFor(i) : { card: nodeId });
    const sideOf = (v: unknown) => (v === 'top' || v === 'right' || v === 'bottom' || v === 'left' ? (v as GsSide) : undefined);
    const linkFrom = (e: Record<string, unknown>, from: GsEndpoint, to: GsEndpoint): GsLink => {
      const link: GsLink = { id: String(e.id), from, to };
      const label = str(e.label);
      const color = str(e.color);
      const st = style(e.styleAttributes);
      if (label) link.label = label;
      if (color) link.color = color;
      if (st) link.style = st;
      const fs = sideOf(e.fromSide);
      const ts = sideOf(e.toSide);
      if (fs) link.fromSide = fs;
      if (ts) link.toSide = ts;
      if (e.fromEnd === 'none' || e.fromEnd === 'arrow') link.fromEnd = e.fromEnd;
      if (e.toEnd === 'none' || e.toEnd === 'arrow') link.toEnd = e.toEnd;
      return link;
    };

    const strategyEdges: { e: Record<string, unknown>; from: Note; to: Note; label: string | null; base: Omit<LegacyEdge, 'id'> }[] = [];
    for (const e of cEdges) {
      const from = info.get(String(e.fromNode));
      const to = info.get(String(e.toNode));
      const label = str(e.label) ?? null;
      const base = {
        source: 'canvas' as const,
        from: from?.endpoint ?? `missing:${String(e.fromNode)}`,
        to: to?.endpoint ?? `missing:${String(e.toNode)}`,
        toPath: to && (to.kind === 'note' || (to.kind === 'card' && !to.endpoint.startsWith('card:'))) ? to.endpoint : null,
        label,
        canvasId: String(e.id),
      };
      if (!from || !to || from.kind === 'unknown' || to.kind === 'unknown') {
        record(base, { kind: 'unclassified', reason: `canvas edge ${String(e.id)} touches a missing or unknown node` });
      } else if (from.kind === 'frame' || to.kind === 'frame') {
        record(base, { kind: 'dropped', reason: `touches a group; groups become frames, which carry no links (D14)` });
      } else if (from.kind === 'card' || to.kind === 'card') {
        const link = linkFrom(e, cardEndpoint(String(e.fromNode), from), cardEndpoint(String(e.toNode), to));
        gsmap.links.push(link);
        record(base, { kind: 'gsmap-link', link: link.id, reason: 'touches a card: free card link (D8)' });
      } else {
        strategyEdges.push({ e, from: from.note, to: to.note, label, base });
      }
    }

    const askCanvasEdge = (s: (typeof strategyEdges)[number], why: string): Fate => {
      const id = String(s.e.id);
      const a = ask(
        `canvas-edge: ${id}`,
        'canvas-edge',
        canvasPath,
        `Canvas edge ${id}: ${s.from.basename} → ${s.to.basename}${s.label ? ` labelled "${s.label}"` : ''} — ${why}.`,
        ['drop', 'annotate', '{ relation: serves | requires | next | assumptions | ultimately-serves, reversed: false }']
      );
      if (a.answer === undefined) return open(a);
      const word = answerWord(a);
      if (word === 'drop') {
        accept(a);
        return { kind: 'dropped', reason: `canvas-only edge${s.label ? ` "${s.label}"` : ''}; dropped (resolution)` };
      }
      if (word === 'annotate') {
        accept(a);
        const link = linkFrom(s.e, { note: s.from.id ?? s.from.path }, { note: s.to.id ?? s.to.path });
        gsmap.links.push(link);
        return { kind: 'gsmap-link', link: link.id, reason: 'kept as a note↔note annotation in the .gsmap (resolution)' };
      }
      const field = answerField(a, 'relation');
      if (typeof field !== 'string' || !RELATIONS.some((r) => r.field === field)) {
        reject(a, 'expected drop, annotate or { relation: <field> }');
        return open(a);
      }
      const f = field as RelField;
      let [holder, target] = answerField(a, 'reversed') === true ? [s.to, s.from] : [s.from, s.to];
      if (f === 'assumptions' && holder.type === 'assumption') [holder, target] = [target, holder];
      if (!allowed(f, holder.type, target.type)) {
        reject(a, `${article(holder.type!)} can't have \`${f}\` pointing at ${article(target.type!)}`);
        return open(a);
      }
      if (f === 'next' && !has(holder.path, 'next', target.path) && targets(fieldPlan(holder.path, 'next')).length) {
        reject(a, `${holder.basename} already has a \`next\``);
        return open(a);
      }
      addRelation(holder.path, f, linkTo(target.path), target.path);
      accept(a);
      return { kind: 'written', field: f, holder: holder.path, target: target.path, how: 'added from the canvas (resolution)' };
    };

    // "On kill" first: it may add a `next` that later edges match.
    const isOnKill = (s: (typeof strategyEdges)[number]) => s.label?.trim().toLowerCase() === 'on kill';
    for (const s of strategyEdges.filter(isOnKill)) {
      if (s.from.type !== 'bet' || s.to.type !== 'bet') {
        record(s.base, askCanvasEdge(s, `"On kill" between ${article(s.from.type!)} and ${article(s.to.type!)}`));
      } else if (has(s.from.path, 'next', s.to.path)) {
        record(s.base, { kind: 'written', field: 'next', holder: s.from.path, target: s.to.path, how: 'canvas "On kill" matches `next`' });
      } else if (!targets(fieldPlan(s.from.path, 'next')).length) {
        addRelation(s.from.path, 'next', linkTo(s.to.path), s.to.path);
        record(s.base, { kind: 'written', field: 'next', holder: s.from.path, target: s.to.path, how: 'added from canvas "On kill"' });
      } else {
        record(s.base, askCanvasEdge(s, `"On kill", but ${s.from.basename} already has a different \`next\``));
      }
    }

    // "AND" junction cards: incoming bets are prerequisites of the outgoing bets (D7).
    for (const card of gsmap.cards) {
      if (card.kind !== 'text' || card.text.trim().toUpperCase() !== 'AND') continue;
      const ends = (dir: 'in' | 'out') =>
        cEdges
          .filter((e) => String(dir === 'in' ? e.toNode : e.fromNode) === card.id)
          .map((e) => info.get(String(dir === 'in' ? e.fromNode : e.toNode)))
          .filter((i): i is Info & { kind: 'note' } => i?.kind === 'note' && i.note.type === 'bet')
          .map((i) => i.note);
      const ins = ends('in');
      const outs = ends('out');
      const pairs = outs.flatMap((o) => ins.filter((i) => i !== o).map((i) => [o, i] as const));
      if (!pairs.length) continue;
      const missing = pairs.filter(([o, i]) => !has(o.path, 'requires', i.path));
      const what = pairs.map(([o, i]) => `${o.basename} requires ${i.basename}`).join('; ');
      if (!missing.length) {
        findings.push({ severity: 'info', path: canvasPath, message: `"AND" card ${card.id} matches \`requires\`: ${what}.` });
        continue;
      }
      const a = ask(`junction: ${card.id}`, 'junction', canvasPath, `"AND" card ${card.id} joins bets: ${what}. Write these as \`requires\`?`, ['requires', 'none']);
      const word = answerWord(a);
      if (word === 'requires') {
        for (const [o, i] of missing) {
          addRelation(o.path, 'requires', linkTo(i.path), i.path);
          derived.push({ field: 'requires', holder: o.path, target: i.path, why: `"AND" card ${card.id} (resolution)` });
        }
        accept(a);
      } else if (word === 'none') accept(a);
      else if (a.answer !== undefined) reject(a, 'expected requires or none');
    }

    // Every other note↔note edge: already a relation, or a candidate for the user.
    const anyRelation = (x: Note, y: Note) => {
      for (const [holder, target] of [[x, y], [y, x]] as const) {
        for (const plan of fieldPlans.get(holder.path)?.values() ?? []) {
          if (targets(plan).includes(target.path)) return { field: plan.field, holder: holder.path, target: target.path };
        }
      }
      return null;
    };
    for (const s of strategyEdges.filter((x) => !isOnKill(x))) {
      const match = anyRelation(s.from, s.to);
      if (match) {
        const how = `canvas edge${s.label ? ` "${s.label}"` : ''} matches \`${match.field}\``;
        record(s.base, { kind: 'written', ...match, how });
      } else {
        record(s.base, askCanvasEdge(s, 'no relation connects these notes (candidate relation)'));
      }
    }
  }

  // ---------------------------------------------------------------- render notes
  const changes: FileChange[] = [];
  for (const note of [...notes.values()].sort((a, b) => sortPaths(a.path, b.path))) {
    if (note.yamlError) continue;
    const summary: string[] = [];
    const eol = eolOf(note.content);
    const split: SplitNote = { ...note.split };
    let doc = note.doc!;
    if (split.yaml === null) {
      // A strategy note without frontmatter (e.g. Current Position): give it one.
      const fresh = parseYaml('');
      doc = fresh.doc!;
      split.open = '---' + eol;
      split.close = eol + '---' + eol;
    }
    editFrontmatter(note, doc, summary);
    if (summary.length || note.split.yaml !== null) split.yaml = stringifyYaml(doc, eol);
    split.body = editBody(note, eol, summary);
    const after = joinNote(split);
    if (after !== note.content) changes.push({ path: note.path, before: note.content, after, summary });
  }

  function editFrontmatter(note: Note, doc: Document, summary: string[]) {
    // id first, as in the schema (D4: positions are keyed by it).
    const idPair = findPair(doc, 'id');
    if (note.template) {
      if (!idPair) {
        insertPair(doc, 0, 'id', emptyValue());
        summary.push('add empty `id`');
      }
    } else if (note.id && (!idPair || idPair.value == null || String((idPair.value as { value?: unknown }).value ?? '').trim() === '')) {
      if (idPair) setScalar(idPair, note.id);
      else insertPair(doc, 0, 'id', note.id);
      summary.push(`id: ${note.id}`);
    }
    if (note.type === 'current-position' && (note.data.type == null || note.data.type === '')) {
      const typePair = findPair(doc, 'type');
      if (typePair) setScalar(typePair, 'current-position');
      else insertPair(doc, pairIndex(doc, 'id') + 1, 'type', 'current-position');
      summary.push('type: current-position');
    }
    const status = newStatus.get(note.path);
    if (status) {
      setScalar(findPair(doc, 'status')!, status);
      summary.push(`status: ${String(note.data.status)} → ${status}`);
    }

    if (note.template) {
      const legacy = findPair(doc, 'next sequel');
      if (legacy && !findPair(doc, 'next')) {
        renameKey(legacy, 'next');
        summary.push('`next sequel` → `next`');
      }
      if (note.data.type === 'bet') {
        for (const key of ['requires', 'assumptions']) {
          if (!findPair(doc, key)) {
            insertPair(doc, insertionIndex(doc, key), key, emptyValue());
            summary.push(`add empty \`${key}\``);
          }
        }
      }
      return;
    }

    const plans = fieldPlans.get(note.path) ?? new Map<RelField, FieldPlan>();
    for (const field of RELATION_ORDER.map((keys) => keys[0] as RelField)) {
      const plan = plans.get(field);
      if (!plan) continue;
      const kept = plan.entries.filter((e) => e.keep);
      const changed = plan.added.length > 0 || kept.length !== plan.entries.length || kept.some((e) => e.replace !== undefined);
      const listField = field !== 'next';
      const normalize = listField && plan.wasScalar && kept.length > 0;
      const renamed = plan.keys.includes('next sequel');
      if (!changed && !normalize && !renamed) continue;

      const nodes = kept.map((e) => (e.replace !== undefined || !e.node ? quoted(e.replace ?? e.text) : e.node));
      for (const a of plan.added) nodes.push(quoted(a.text));

      let pair = findPair(doc, field);
      if (renamed) {
        const legacy = findPair(doc, 'next sequel')!;
        if (!pair) {
          renameKey(legacy, field);
          pair = legacy;
        } else removePair(doc, 'next sequel');
        summary.push('`next sequel` → `next`');
      }
      if (!pair) pair = insertPair(doc, insertionIndex(doc, field), field, emptyValue());
      const p: Pair = pair;
      if (!listField && nodes.length === 1 && (plan.wasScalar || !plan.entries.length)) p.value = nodes[0];
      else setList(p, nodes);

      if (normalize) summary.push(`${field}: scalar → list`);
      for (const e of plan.entries) {
        if (!e.keep) summary.push(`${field}: − ${e.text}`);
        else if (e.replace !== undefined) summary.push(`${field}: ${e.text} → ${e.replace}`);
      }
      for (const a of plan.added) summary.push(`${field}: + ${a.text}`);
    }
  }

  function editBody(note: Note, eol: '\n' | '\r\n', summary: string[]): string {
    const plans = sectionPlans.get(note.path) ?? [];
    if (!plans.length) return note.split.body;
    const lines = note.split.body.split('\n');
    const cr = eol === '\r\n' ? '\r' : '';
    const out: string[] = [];
    let i = 0;
    for (const s of [...plans].sort((a, b) => a.start - b.start)) {
      out.push(...lines.slice(i, s.start));
      i = s.end;
      if (s.action === 'keep') {
        out.push(...lines.slice(s.start, s.end));
        summary.push(`\`## ${s.heading}\` kept (resolution or open question)`);
      } else if (s.action === 'remove') {
        summary.push(`\`## ${s.heading}\` removed`);
      } else {
        // Keep the heading line and the blank lines that separate it from the next section.
        let trailing = s.end;
        while (trailing > s.start + 1 && lines[trailing - 1].replace(/\r$/, '').trim() === '') trailing--;
        out.push(lines[s.start], ...dependedOnByBlock(root).map((l) => l + cr), ...lines.slice(trailing, s.end));
        summary.push(`\`## ${s.heading}\` → Dataview block`);
      }
    }
    out.push(...lines.slice(i));
    return out.join('\n');
  }

  // ---------------------------------------------------------------- .gsmap
  const gsmapText = serializeGsMap(gsmap);
  if (files[gsmapPath] !== gsmapText) {
    changes.push({
      path: gsmapPath,
      before: files[gsmapPath] ?? null,
      after: gsmapText,
      summary: [
        `${Object.keys(gsmap.positions).length} positions, ${gsmap.cards.length} cards, ${gsmap.frames.length} frames, ${gsmap.links.length} links`,
      ],
    });
  }

  // ---------------------------------------------------------------- result
  const asked = new Set(ambiguities.keys());
  const staleResolutions = Object.keys(resolutions).filter((k) => !asked.has(k) && resolutions[k] != null);
  const plannedNotes: PlannedNote[] = strategy.map((n) => ({ path: n.path, type: n.type!, id: n.id })).sort((a, b) => sortPaths(a.path, b.path));

  return {
    oracle: edges.map((e) => e.edge),
    edges,
    derived,
    ambiguities: [...ambiguities.values()],
    staleResolutions,
    changes,
    gsmap,
    canvasNodes,
    notes: plannedNotes,
    findings,
  };
}

/** The vault after the plan: every planned change applied to a copy. */
export function applyPlan(files: Readonly<Record<string, string>>, plan: MigrationPlan): Record<string, string> {
  const out = { ...files };
  for (const change of plan.changes) out[change.path] = change.after;
  return out;
}
