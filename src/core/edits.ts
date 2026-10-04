/**
 * Editing from the graph as pure "intent → planned writes" functions (plan Phase 6), next to the
 * creation planners in `actions.ts` that the graph's quick actions reuse. Nothing is written
 * here: a plan is validated against the graph first, so a bad request (a status the type doesn't
 * have, a link the schema doesn't allow, a sequel that isn't dormant) is refused with a reason
 * and nothing is touched. The adapter performs the writes (`writes.ts`).
 *
 * Intents name notes by graph key, never by path, because that is what the graph knows.
 */
import { planAssumption, planBet, planMilestone } from './actions';
import { BETS_FOLDER } from './constants';
import { FALSIFIER_HEADING, FALSIFIER_PLACEHOLDER } from './content';
import { readLinkField, resolveLinkpath } from './links';
import { isPlanError, type FileRef, type PlanError, type VaultLike } from './plan';
import { relationFor, RELATIONS, statusesFor, targetsOf, type Graph, type GraphNode } from './schema';
import { logLine, type PlannedWrite, type RelationField } from './writes';
import type { ActionPlan } from './actions';

export interface BetFields {
  title: string;
  x: string;
  y: string;
  z: string;
  deadline: string;
}

export interface AssumptionFields {
  statement: string;
  falsifier: string;
  verifyBy: string;
}

export type Intent =
  /** The status pill: any status the note's type has. */
  | { kind: 'set-status'; key: string; status: string }
  /** `deadline` of a bet or `verify-by` of an assumption, as `YYYY-MM-DD`; empty clears it. */
  | { kind: 'set-date'; key: string; value: string }
  /** `expected-result` of a bet, or the "How I'd Know It's False" section of an assumption. */
  | { kind: 'set-text'; key: string; field: 'expected-result' | 'falsifier'; value: string }
  | { kind: 'add-relation'; holder: string; field: RelationField; target: string }
  | { kind: 'remove-relation'; holder: string; field: RelationField; target: string }
  /** "+ log entry": a dated line under `## Log`. */
  | { kind: 'log'; key: string; text: string }
  /** One atomic action: the bet becomes `killed`, its `next` bet `active`, and both notes get a log line. */
  | { kind: 'kill-activate-next'; key: string }
  /** The assumption becomes `falsified`; the bets leaning on it are flagged by the graph's smells. */
  | { kind: 'falsify'; key: string }
  /** A bet serving `serves`, or the sequel of `sequelOf` (which then gets it as `next`, and its `serves` when none are given). */
  | { kind: 'new-bet'; form: BetFields; serves: string[]; sequelOf?: string }
  /** A milestone (D17), `open`, serving the given fixed points or milestones. */
  | { kind: 'new-milestone'; form: { title: string; description: string }; serves: string[] }
  /** An assumption that the `dependents` (bets, fixed points, milestones) lean on. */
  | { kind: 'new-assumption'; form: AssumptionFields; dependents: string[] };

/** Whether the intent can change what the graph is derived from (a log line or a falsifier text can't). */
export const changesGraph = (intent: Intent): boolean => intent.kind !== 'log' && !(intent.kind === 'set-text' && intent.field === 'falsifier');

export interface EditEnv {
  graph: Graph;
  /** For ids and collisions when a note is created. */
  vault: VaultLike<FileRef>;
  /** Today as `YYYY-MM-DD`. */
  today: string;
}

const fail = (error: string): PlanError => ({ error });
const label = (node: GraphNode) => node.id ?? node.basename;
const linkTo = (node: GraphNode) => '[[' + node.basename + ']]';
const refOf = (node: GraphNode): FileRef => ({ path: node.path, basename: node.basename });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A refusal when `value` is filled in but is not `YYYY-MM-DD`: a date is written into frontmatter as it is. */
const badDateIn = (value: string): PlanError | null => (value.trim() && !DATE.test(value.trim()) ? fail(`"${value.trim()}" is not a date (YYYY-MM-DD).`) : null);

/** The plan with the note it creates named (`B-9 Title.md` is `B-9`), and not opened: the graph stays in front. */
function stayingPut(plan: ActionPlan): ActionPlan {
  const made = plan.writes.find((w) => w.kind === 'create' && w.path === plan.open);
  const id = made && /^[A-Z]+-\d+/.exec(made.path.slice(made.path.lastIndexOf('/') + 1));
  return { ...plan, open: null, ...(made && id ? { created: { id: id[0], path: made.path } } : {}) };
}

/** What to do for an intent. A plan with no writes means nothing to change (the notice says why). */
export function planIntent(intent: Intent, env: EditEnv): ActionPlan | PlanError {
  const node = (key: string) => env.graph.nodes.find((n) => n.key === key);
  const need = (key: string): GraphNode | PlanError => node(key) ?? fail(`The note ${key} is not on the graph any more.`);
  const done = (writes: PlannedWrite[], notice: string): ActionPlan => ({ writes, open: null, notice });

  switch (intent.kind) {
    case 'set-status': {
      const n = need(intent.key);
      if (isPlanError(n)) return n;
      const allowed = statusesFor(n.type);
      if (!allowed) return fail(`${label(n)} is a ${n.type}: it has no status.`);
      if (!allowed.includes(intent.status)) return fail(`"${intent.status}" is not a status of a ${n.type} (${allowed.join(', ')}).`);
      if (n.status === intent.status) return done([], `${label(n)} is already ${intent.status}.`);
      return done([{ kind: 'set-field', path: n.path, field: 'status', value: intent.status }], `${label(n)} is now ${intent.status}.`);
    }

    case 'set-date': {
      const n = need(intent.key);
      if (isPlanError(n)) return n;
      const field = n.type === 'bet' ? 'deadline' : n.type === 'assumption' ? 'verify-by' : null;
      if (!field) return fail(`${label(n)} is a ${n.type}: it has no ${n.type === 'milestone' ? 'date' : 'deadline or verify-by'}.`);
      const value = intent.value.trim();
      if (value && !DATE.test(value)) return fail(`"${value}" is not a date (YYYY-MM-DD).`);
      return done(
        [{ kind: 'set-field', path: n.path, field, value: value || null }],
        value ? `${label(n)}: ${field} is ${value}.` : `${label(n)}: ${field} cleared.`
      );
    }

    case 'set-text': {
      const n = need(intent.key);
      if (isPlanError(n)) return n;
      if (intent.field === 'expected-result') {
        if (n.type !== 'bet') return fail(`${label(n)} is a ${n.type}: only a bet has an expected result.`);
        return done([{ kind: 'set-field', path: n.path, field: 'expected-result', value: intent.value.trim() }], `${label(n)}: expected result saved.`);
      }
      if (n.type !== 'assumption') return fail(`${label(n)} is a ${n.type}: only an assumption has a falsifier.`);
      // A line like `## x` would start a new section of the note, and the next read would cut the falsifier short.
      if (/^\s{0,3}#{1,6}(\s|$)/m.test(intent.value)) return fail("A falsifier can't contain a heading line (one starting with #).");
      const text = intent.value.trim() || FALSIFIER_PLACEHOLDER;
      return done([{ kind: 'replace-section', path: n.path, heading: FALSIFIER_HEADING, text }], `${label(n)}: falsifier saved.`);
    }

    case 'add-relation': {
      const holder = need(intent.holder);
      if (isPlanError(holder)) return holder;
      const target = need(intent.target);
      if (isPlanError(target)) return target;
      const problem = relationProblem(env.graph, holder, intent.field, target);
      if (problem) return fail(problem);
      const write: PlannedWrite =
        intent.field === 'next'
          ? { kind: 'set-field', path: holder.path, field: 'next', value: linkTo(target) }
          : { kind: 'add-link', path: holder.path, field: intent.field, link: linkTo(target) };
      return done([write], `${describeRelation(holder, intent.field, target)}.`);
    }

    case 'remove-relation': {
      const holder = need(intent.holder);
      if (isPlanError(holder)) return holder;
      const target = need(intent.target);
      if (isPlanError(target)) return target;
      const paths = env.graph.nodes.map((n) => n.path);
      const linkpaths = readLinkField(holder.frontmatter[intent.field]).linkpaths.filter(
        (linkpath) => resolveLinkpath(linkpath, holder.path, paths) === target.path
      );
      if (!linkpaths.length) return fail(`${label(holder)} has no ${intent.field} link to ${label(target)}.`);
      return done([{ kind: 'remove-link', path: holder.path, field: intent.field, linkpaths }], `Removed: ${describeRelation(holder, intent.field, target)}.`);
    }

    case 'log': {
      const n = need(intent.key);
      if (isPlanError(n)) return n;
      if (!intent.text.trim()) return fail('A log entry needs some text.');
      return done([{ kind: 'append-log', path: n.path, line: logLine(env.today, intent.text) }], `Logged on ${label(n)}.`);
    }

    case 'kill-activate-next': {
      const bet = need(intent.key);
      if (isPlanError(bet)) return bet;
      if (bet.type !== 'bet') return fail(`${label(bet)} is a ${bet.type}: only a bet can be killed.`);
      if (bet.status === 'killed' || bet.status === 'won') return fail(`${label(bet)} is already ${bet.status}.`);
      const edge = env.graph.edges.find((e) => e.kind === 'next' && e.from === bet.key);
      const sequel = edge && node(edge.to);
      if (!sequel) return fail(`${label(bet)} has no next sequel to activate.`);
      if (sequel.status !== 'dormant') {
        return fail(`${label(sequel)} is ${sequel.status ?? 'without a status'}: only a dormant sequel can be activated.`);
      }
      return done(
        [
          // The sequel first: a failure half-way leaves two active bets (flagged), never none.
          { kind: 'set-field', path: sequel.path, field: 'status', value: 'active' },
          { kind: 'append-log', path: sequel.path, line: logLine(env.today, `Activated: ${linkTo(bet)} was killed.`) },
          { kind: 'set-field', path: bet.path, field: 'status', value: 'killed' },
          { kind: 'append-log', path: bet.path, line: logLine(env.today, `Killed. Activating ${linkTo(sequel)}.`) },
        ],
        `${label(bet)} killed, ${label(sequel)} is active.`
      );
    }

    case 'falsify': {
      const a = need(intent.key);
      if (isPlanError(a)) return a;
      if (a.type !== 'assumption') return fail(`${label(a)} is a ${a.type}: only an assumption can be falsified.`);
      if (a.status === 'falsified') return done([], `${label(a)} is already falsified.`);
      const leaning = env.graph.edges
        .filter((e) => e.kind === 'assumption' && e.to === a.key)
        .map((e) => node(e.from))
        .filter((n): n is GraphNode => !!n && n.status === 'active');
      const flagged = leaning.length ? ` ${leaning.map(label).join(', ')} ${leaning.length === 1 ? 'is' : 'are'} active and depend${leaning.length === 1 ? 's' : ''} on it: flagged.` : '';
      return done(
        [
          { kind: 'set-field', path: a.path, field: 'status', value: 'falsified' },
          { kind: 'append-log', path: a.path, line: logLine(env.today, 'Falsified.') },
        ],
        `${label(a)} falsified.${flagged}`
      );
    }

    case 'new-bet': {
      const source = intent.sequelOf ? need(intent.sequelOf) : null;
      if (source && isPlanError(source)) return source;
      if (source) {
        if (source.type !== 'bet') return fail(`${label(source)} is a ${source.type}: only a bet has a sequel.`);
        if (env.graph.edges.some((e) => e.kind === 'next' && e.from === source.key)) return fail(`${label(source)} already has a next sequel.`);
      }
      // A sequel takes over what the bet it follows serves, unless told otherwise.
      const servesKeys =
        intent.serves.length || !source
          ? intent.serves
          : env.graph.edges.filter((e) => e.kind === 'serves' && e.from === source.key).map((e) => e.to);
      const serves: GraphNode[] = [];
      for (const key of servesKeys) {
        const n = need(key);
        if (isPlanError(n)) return n;
        serves.push(n);
      }
      const title = intent.form.title.trim();
      const badDate = badDateIn(intent.form.deadline);
      if (badDate) return badDate;
      const plan = planBet(
        env.vault,
        {
          title,
          x: intent.form.x.trim(),
          y: intent.form.y.trim() || title,
          z: intent.form.z.trim(),
          deadline: intent.form.deadline.trim(),
          servesFiles: serves.map(refOf),
          assumptionRows: [],
          // A sequel waits for its predecessor to be killed (`kill-activate-next` only starts a dormant one).
          ...(source ? { status: 'dormant' as const } : {}),
        },
        env.today
      );
      if (isPlanError(plan)) return plan;
      const created = plan.writes.find((w) => w.kind === 'create' && w.path === plan.open);
      if (!source) return stayingPut(plan);
      const basename = created!.path.slice(BETS_FOLDER.length + 1).replace(/\.md$/, '');
      return {
        ...stayingPut(plan),
        writes: [...plan.writes, { kind: 'set-field', path: source.path, field: 'next', value: '[[' + basename + ']]' }],
        notice: `${plan.notice} It is ${label(source)}'s next sequel.`,
      };
    }

    case 'new-milestone': {
      const serves: GraphNode[] = [];
      for (const key of intent.serves) {
        const n = need(key);
        if (isPlanError(n)) return n;
        serves.push(n);
      }
      const plan = planMilestone(env.vault, { title: intent.form.title, description: intent.form.description, servesFiles: serves.map(refOf) }, env.today);
      return isPlanError(plan) ? plan : stayingPut(plan);
    }

    case 'new-assumption': {
      const badDate = badDateIn(intent.form.verifyBy);
      if (badDate) return badDate;
      const dependents: GraphNode[] = [];
      for (const key of intent.dependents) {
        const n = need(key);
        if (isPlanError(n)) return n;
        dependents.push(n);
      }
      const plan = planAssumption(
        env.vault,
        {
          statement: intent.form.statement.trim(),
          falsifier: intent.form.falsifier.trim(),
          verifyBy: intent.form.verifyBy.trim(),
          dependentFiles: dependents.map(refOf),
        },
        env.today
      );
      return isPlanError(plan) ? plan : stayingPut(plan);
    }
  }
}

/** Why `holder` can't take `target` through `field`, or null when it can. */
function relationProblem(graph: Graph, holder: GraphNode, field: RelationField, target: GraphNode): string | null {
  const rule = relationFor(field);
  const allowed = targetsOf(rule, holder.type);
  if (!allowed) return `A ${holder.type} can't have ${field}.`;
  if (holder.key === target.key) return `${label(holder)} can't ${field} itself.`;
  if (!allowed.includes(target.type)) return `${field} of a ${holder.type} can only point at ${allowed.join(' or ')}, not a ${target.type}.`;
  if (graph.edges.some((e) => e.kind === rule.kind && e.from === holder.key && e.to === target.key)) {
    return `${describeRelation(holder, field, target)} already.`;
  }
  if (field === 'next' && graph.edges.some((e) => e.kind === 'next' && e.from === holder.key)) {
    return `${label(holder)} already has a next sequel: remove it first.`;
  }
  return null;
}

/** "B-2 serves B-1", "B-1 requires B-2", "B-1 depends on A-1": the same words the menus use. */
export function describeRelation(holder: GraphNode, field: RelationField, target: GraphNode): string {
  const verb: Record<RelationField, string> = {
    serves: 'serves',
    'ultimately-serves': 'ultimately serves',
    requires: 'requires',
    next: 'has next sequel',
    assumptions: 'depends on',
  };
  return `${label(holder)} ${verb[field]} ${label(target)}`;
}

export interface RelationCandidate {
  holder: string;
  field: RelationField;
  target: string;
  label: string;
  /** Set when the relation is possible by type but can't be made now (it exists, or `next` is taken). */
  blocked?: string;
}

/**
 * The relations a drag from `source` to `target` can mean, inferred from their types (Phase 6).
 * The drawing convention is the layout's: `serves`, `ultimately-serves` and `next` run from the
 * holder, `requires` runs from the prerequisite into the holder, and an assumption's leader may be
 * drawn either way. One candidate means the edge can be made at once; several need a question.
 */
export function relationCandidates(graph: Graph, source: string, target: string): RelationCandidate[] {
  const from = graph.nodes.find((n) => n.key === source);
  const to = graph.nodes.find((n) => n.key === target);
  if (!from || !to || from.key === to.key) return [];
  const out: RelationCandidate[] = [];
  for (const rule of RELATIONS) {
    const field = rule.field as RelationField;
    const holderIsSource = field === 'serves' || field === 'ultimately-serves' || field === 'next';
    const orders: [GraphNode, GraphNode][] =
      field === 'assumptions' ? [[from, to], [to, from]] : holderIsSource ? [[from, to]] : [[to, from]];
    for (const [holder, other] of orders) {
      if (!targetsOf(rule, holder.type)?.includes(other.type)) continue;
      const blocked = relationProblem(graph, holder, field, other) ?? undefined;
      out.push({ holder: holder.key, field, target: other.key, label: describeRelation(holder, field, other), ...(blocked ? { blocked } : {}) });
    }
  }
  return out;
}
