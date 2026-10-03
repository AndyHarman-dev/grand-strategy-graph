import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { StrategyFlowNode } from './model';

/**
 * A note on the graph: id, title, status. Plain on purpose: per-type shapes, colours and
 * the smell badge are Phase 5b. Handles exist only so edges have ends; nothing connects by
 * hand until Phase 6.
 */
function StrategyNodeView({ data, selected }: NodeProps<StrategyFlowNode>) {
  const { node, title, pinnable } = data;
  const classes = ['gs-node', `gs-node--${node.type}`];
  if (node.status) classes.push(`gs-status--${node.status}`);
  if (selected) classes.push('is-selected');
  if (!pinnable) classes.push('is-unpinnable');
  const date = node.type === 'bet' ? node.deadline : node.type === 'assumption' ? node.verifyBy : null;
  return (
    <div className={classes.join(' ')} data-node-key={node.key} data-path={node.path} title={node.path}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="gs-node-head">
        <span className="gs-node-id">{node.id ?? '(no id)'}</span>
        {node.status && <span className="gs-node-status">{node.status}</span>}
      </div>
      <div className="gs-node-title">{title}</div>
      {date && <div className="gs-node-date">{date.slice(0, 10)}</div>}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

export const StrategyNode = memo(StrategyNodeView);
