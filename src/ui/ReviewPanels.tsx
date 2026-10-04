import { useMemo, useState } from 'react';
import type { Graph, GraphNode } from '../core/schema';
import type { Smell } from '../core/smells';
import { reviewWalk, type WalkGroup, type WalkStep } from '../core/review-walk';
import { groupSmellsForPanel, titleOf } from './model';

const idOf = (n: GraphNode) => n.id ?? n.basename;

/**
 * The "Smells" panel (plan Phase 8): everything review would flag, in groups, worst first. Clicking
 * a note centers the graph on it and selects it. The badge on each node says the same on the node.
 */
export function SmellsPanel({ graph, smells, onFocus }: { graph: Graph; smells: readonly Smell[]; onFocus: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups = groupSmellsForPanel(smells);
  const nodeOf = (key: string) => graph.nodes.find((n) => n.key === key);
  return (
    <div className="gs-smells">
      <button className="gs-toolbar-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {smells.length === 1 ? '1 smell' : `${smells.length} smells`}
      </button>
      {open && (
        <div className="gs-smells-list" role="region" aria-label="Smells">
          {groups.length === 0 && <p className="gs-smells-none">Nothing to flag.</p>}
          {groups.map((group) => (
            <section key={group.code} data-code={group.code}>
              <h4>
                {group.title} <span className="gs-smells-count">{group.smells.length}</span>
              </h4>
              <ul>
                {group.smells.map((smell) => {
                  const node = nodeOf(smell.node);
                  return (
                    <li key={`${smell.code}:${smell.node}`}>
                      <button className="gs-smells-item" title={smell.message} onClick={() => onFocus(smell.node)}>
                        {node ? `${idOf(node)} ${titleOf(node)}` : smell.node}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const GROUP_TITLE: Record<WalkGroup, string> = {
  'fixed-point': 'Fixed point',
  route: 'On the way to',
  unrouted: 'Not on any route to a fixed point',
};

/**
 * The review walk (plan Phase 8, replacing the canvas's presentation mode): each fixed point, then
 * outward along the `serves` chains that lead to it, in a fixed order. A step centers the graph on
 * the note and shows what review looks at: status and dates, the route, the smells, the assumptions.
 * It follows the notes: an edit that changes the order keeps the walk on the note it was on.
 */
export function ReviewWalk({
  graph,
  smells,
  current,
  onStep,
  onClose,
}: {
  graph: Graph;
  smells: readonly Smell[];
  /** The key of the note the walk is on. */
  current: string;
  onStep: (key: string) => void;
  onClose: () => void;
}) {
  const steps = useMemo(() => reviewWalk(graph), [graph]);
  const found = steps.findIndex((s) => s.node === current);
  const index = found >= 0 ? found : 0;
  const step: WalkStep | undefined = steps[index];
  if (!step) {
    return (
      <div className="gs-walk" role="dialog" aria-label="Review walk">
        <p>There is nothing to walk through yet: no fixed points, bets or milestones.</p>
        <button onClick={onClose}>Close</button>
      </div>
    );
  }
  const nodeOf = (key: string) => graph.nodes.find((n) => n.key === key);
  const node = nodeOf(step.node)!;
  const fixed = step.fixedPoint ? nodeOf(step.fixedPoint) : null;
  const mine = smells.filter((s) => s.node === step.node);
  const go = (to: number) => steps[to] && onStep(steps[to].node);
  const date = node.type === 'bet' ? node.deadline : node.type === 'assumption' ? node.verifyBy : null;
  const result = typeof node.frontmatter['expected-result'] === 'string' ? (node.frontmatter['expected-result'] as string) : '';
  return (
    <div
      className="gs-walk nowheel nopan nodrag"
      role="dialog"
      aria-label="Review walk"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        else if (event.key === 'ArrowRight') go(index + 1);
        else if (event.key === 'ArrowLeft') go(index - 1);
        else return;
        event.stopPropagation();
      }}
    >
      <header>
        <span className="gs-walk-progress">
          Step {index + 1} of {steps.length}
        </span>
        <button className="gs-walk-close" onClick={onClose} aria-label="End the review walk" title="End the walk">
          ×
        </button>
      </header>
      <p className="gs-walk-group">
        {GROUP_TITLE[step.group]}
        {fixed ? ` ${idOf(fixed)}` : ''}
        {step.group === 'route' ? ` · ${step.depth} ${step.depth === 1 ? 'step' : 'steps'} out` : ''}
      </p>
      <h3>
        {idOf(node)} {titleOf(node)}
        {node.status && <span className="gs-walk-status">{node.status}</span>}
      </h3>
      {step.via.length > 1 && <p className="gs-walk-via">{step.via.map((key) => { const n = nodeOf(key); return n ? idOf(n) : key; }).join(' → ')}</p>}
      {(date || result) && (
        <p className="gs-walk-facts">
          {date && <span>{node.type === 'bet' ? 'Deadline' : 'Verify by'} {date.slice(0, 10)}</span>}
          {result && <span>Expected: {result}</span>}
        </p>
      )}
      {mine.length > 0 && (
        <ul className="gs-walk-smells" aria-label="Smells">
          {mine.map((smell) => (
            <li key={smell.code}>{smell.message}</li>
          ))}
        </ul>
      )}
      {step.assumptions.length > 0 && (
        <div className="gs-walk-assumptions">
          <h4>Assumptions</h4>
          <ul>
            {step.assumptions.map((key) => {
              const a = nodeOf(key);
              return (
                <li key={key} className={a ? `gs-status--${a.status}` : undefined}>
                  {a ? `${idOf(a)} ${titleOf(a)}` : key}
                  {a?.status && <span className="gs-walk-status">{a.status}</span>}
                  {a?.verifyBy && <span className="gs-walk-when"> by {a.verifyBy.slice(0, 10)}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="gs-walk-buttons">
        <button onClick={() => go(index - 1)} disabled={index === 0}>
          ← Previous
        </button>
        <button className="mod-cta" onClick={() => go(index + 1)} disabled={index === steps.length - 1} autoFocus>
          Next →
        </button>
      </div>
    </div>
  );
}
