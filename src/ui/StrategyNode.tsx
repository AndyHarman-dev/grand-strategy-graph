import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useRef, useState, type KeyboardEvent } from 'react';
import { statusesFor } from '../core/schema';
import { useNodeActions } from './actions-context';
import { handleId, type JunctionFlowNode, type Side, type StrategyFlowNode } from './model';

const SIDES: [Side, Position][] = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
];

/** Shown in front of the id: a milestone is a checkpoint, open or reached; a fixed point is an anchor. */
const GLYPH: Partial<Record<string, string>> = { 'fixed-point': '◆', milestone: '◇' };

/** Controls inside a node must not start a drag, a double-click that opens the note, or a pan. */
const INERT = { onDoubleClick: (event: { stopPropagation(): void }) => event.stopPropagation() };

/**
 * A note on the graph: id, status pill, title, deadline or verify-by, and a badge when it has
 * smells. The shape and colour of each type and status are `graph.css` (plan Phase 5b), driven by
 * the classes here. With edits available (Phase 6) the status pill is a dropdown and the date a
 * date field. Handles exist so edges have ends, one pair per side so an edge can leave by
 * whichever side faces its other end (D19); dragging from a source handle draws a relation.
 */
function StrategyNodeView({ data, selected }: NodeProps<StrategyFlowNode>) {
  const { node, title, pinnable, smells } = data;
  const actions = useNodeActions();
  const classes = ['gs-node', `gs-node--${node.type}`];
  if (node.status) classes.push(`gs-status--${node.status}`);
  if (selected) classes.push('is-selected');
  if (!pinnable) classes.push('is-unpinnable');
  if (smells.length) classes.push('has-smells');
  const date = node.type === 'bet' ? node.deadline : node.type === 'assumption' ? node.verifyBy : null;
  const hasDate = node.type === 'bet' || node.type === 'assumption';
  const dateLabel = node.type === 'bet' ? 'deadline' : 'verify by';
  const glyph = node.type === 'milestone' && node.status === 'reached' ? '◆' : GLYPH[node.type];
  const statuses = statusesFor(node.type);
  return (
    <div
      className={classes.join(' ')}
      data-node-key={node.key}
      data-path={node.path}
      title={node.path}
      onMouseEnter={(event) => actions.hover?.(event.nativeEvent, event.currentTarget, node.path)}
    >
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-t`} id={handleId(side, 'target')} type="target" position={position} isConnectable={false} />
      ))}
      <div className="gs-node-head">
        <span className="gs-node-id">
          {glyph && (
            <span className="gs-node-glyph" aria-hidden="true">
              {glyph}{' '}
            </span>
          )}
          {node.id ?? '(no id)'}
        </span>
        {node.status && actions.canEdit && statuses ? (
          <select
            className="gs-node-status nodrag nopan"
            value={node.status}
            aria-label={`Status of ${node.id ?? node.basename}`}
            onChange={(event) => actions.setStatus(node.key, event.target.value)}
            {...INERT}
          >
            {(statuses.includes(node.status) ? statuses : [node.status, ...statuses]).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        ) : (
          node.status && <span className="gs-node-status">{node.status}</span>
        )}
      </div>
      <div className="gs-node-title">{title}</div>
      {hasDate && <NodeDate date={date} label={dateLabel} editable={actions.canEdit} onChange={(value) => actions.setDate(node.key, value)} name={node.id ?? node.basename} />}
      {smells.length > 0 && (
        <span className="gs-node-smell" role="img" aria-label={`${smells.length} smell${smells.length === 1 ? '' : 's'}`} title={smells.map((s) => s.message).join('\n')}>
          {smells.length}
        </span>
      )}
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-s`} id={handleId(side, 'source')} type="source" position={position} isConnectable={actions.canEdit} isConnectableEnd={false} />
      ))}
    </div>
  );
}

/** The deadline or verify-by: text, and with edits a date field after a click (Enter or leaving it saves, Escape cancels). */
function NodeDate({ date, label, editable, onChange, name }: { date: string | null; label: string; editable: boolean; onChange: (value: string) => void; name: string }) {
  const [editing, setEditing] = useState(false);
  /** Escape leaves the field, which can blur it on the way out: that must not save. */
  const cancelled = useRef(false);
  const shown = date ? date.slice(0, 10) : '';
  if (!editable) return shown ? <div className="gs-node-date" title={label}>{shown}</div> : null;
  if (!editing) {
    return (
      <button
        className="gs-node-date gs-node-date--button nodrag nopan"
        title={`Set ${label}`}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        {...INERT}
      >
        {shown || `set ${label}`}
      </button>
    );
  }
  const finish = (value: string | null) => {
    if (cancelled.current) return;
    if (value === null) cancelled.current = true;
    setEditing(false);
    if (value !== null && value !== shown) onChange(value);
  };
  return (
    <input
      className="gs-node-date gs-node-date--input nodrag nopan"
      type="date"
      autoFocus
      defaultValue={shown}
      aria-label={`${label} of ${name}`}
      onBlur={(event) => finish(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(event.currentTarget.value);
        else if (event.key === 'Escape') finish(null);
      }}
      {...INERT}
    />
  );
}

export const StrategyNode = memo(StrategyNodeView);

/**
 * The "AND" in front of a note that requires two or more others: all of them must be done before
 * it. Drawn from the links, so it can't be added, moved or deleted by hand; it follows its note.
 */
function JunctionNodeView({ data }: NodeProps<JunctionFlowNode>) {
  return (
    <div className="gs-junction" data-junction-for={data.holder} title={`Requires all of: ${data.prerequisites.join(', ')}`}>
      <span>AND</span>
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-t`} id={handleId(side, 'target')} type="target" position={position} isConnectable={false} />
      ))}
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-s`} id={handleId(side, 'source')} type="source" position={position} isConnectable={false} />
      ))}
    </div>
  );
}

export const JunctionNode = memo(JunctionNodeView);
