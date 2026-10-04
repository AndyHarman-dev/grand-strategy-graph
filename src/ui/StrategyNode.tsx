import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useNodeActions } from './actions-context';
import { handleId, type Side, type StrategyFlowNode } from './model';

const SIDES: [Side, Position][] = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
];

/** Shown in front of the id: a milestone is a checkpoint, open or reached; a fixed point is locked. */
const GLYPH: Partial<Record<string, string>> = { 'fixed-point': '◆', milestone: '◇' };

/**
 * A note on the graph: id, status pill, title, deadline or verify-by, and a badge when it has
 * smells. The shape and colour of each type and status are `graph.css` (plan Phase 5b), driven by
 * the classes here. Handles exist only so edges have ends, one pair per side so an edge can leave
 * by whichever side faces its other end (D19).
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
  const dateLabel = node.type === 'bet' ? 'deadline' : 'verify by';
  const glyph = node.type === 'milestone' && node.status === 'reached' ? '◆' : GLYPH[node.type];
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
        {node.status && <span className="gs-node-status">{node.status}</span>}
      </div>
      <div className="gs-node-title">{title}</div>
      {date && (
        <div className="gs-node-date" title={dateLabel}>
          {date.slice(0, 10)}
        </div>
      )}
      {smells.length > 0 && (
        <span className="gs-node-smell" role="img" aria-label={`${smells.length} smell${smells.length === 1 ? '' : 's'}`} title={smells.map((s) => s.message).join('\n')}>
          {smells.length}
        </span>
      )}
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-s`} id={handleId(side, 'source')} type="source" position={position} isConnectable={false} />
      ))}
    </div>
  );
}

export const StrategyNode = memo(StrategyNodeView);
