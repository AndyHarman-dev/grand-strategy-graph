import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, type KeyboardEvent } from 'react';
import { useNodeActions } from './actions-context';
import { cssColor, handleId, type CardFlowNode, type FrameFlowNode, type Side } from './model';

const SIDES: [Side, Position][] = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
];

const INERT = { onDoubleClick: (event: { stopPropagation(): void }) => event.stopPropagation() };

/** A textarea that takes focus, saves on blur or Ctrl/Cmd+Enter, and cancels on Escape. */
function InlineText({ initial, onCommit, onCancel, label, single }: { initial: string; onCommit: (text: string) => void; onCancel: () => void; label: string; single?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Escape and Enter leave the field, which blurs it on the way out: that must not save twice. */
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    if (text === null) onCancel();
    else onCommit(text);
  };
  return (
    <textarea
      ref={ref}
      className="gs-inline-text nodrag nopan nowheel"
      aria-label={label}
      defaultValue={initial}
      rows={single ? 1 : undefined}
      onBlur={(event) => finish(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();
        if (event.key === 'Escape') finish(null);
        else if (event.key === 'Enter' && (single || event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish(event.currentTarget.value);
        }
      }}
      {...INERT}
    />
  );
}

/**
 * A free card (D8): text only the graph knows, a reference to a note that is not a strategy note,
 * or a link. Double-click edits a text card, opens a note reference or a link. The canvas's colour
 * and `border`/`shape` styles carry over.
 */
function CardNodeView({ data, selected }: NodeProps<CardFlowNode>) {
  const { card } = data;
  const actions = useNodeActions();
  const editing = actions.editing?.kind === 'card' && actions.editing.id === card.id;
  const classes = ['gs-card', `gs-card--${card.kind}`];
  if (selected) classes.push('is-selected');
  if (card.style?.border === 'dashed') classes.push('gs-card--dashed');
  if (card.style?.border === 'invisible') classes.push('gs-card--invisible');
  if (card.style?.shape === 'diamond') classes.push('gs-card--diamond');
  if (card.style?.textAlign === 'center') classes.push('gs-card--center');
  const color = cssColor(card.color);
  const shown = card.kind === 'text' ? card.text : card.kind === 'note-ref' ? card.file.slice(card.file.lastIndexOf('/') + 1).replace(/\.md$/, '') : card.url;
  return (
    <div className={classes.join(' ')} data-card-id={card.id} style={color ? ({ '--gs-c': color } as React.CSSProperties) : undefined} title={card.kind === 'text' ? undefined : card.kind === 'note-ref' ? card.file : card.url}>
      <NodeResizer
        isVisible={selected && actions.canEditMap}
        minWidth={60}
        minHeight={40}
        onResizeEnd={(_event, rect) => actions.resize('card', card.id, rect)}
      />
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-t`} id={handleId(side, 'target')} type="target" position={position} isConnectable={false} />
      ))}
      {editing && card.kind === 'text' ? (
        <InlineText initial={card.text} label="Card text" onCommit={(text) => actions.commitText('card', card.id, text)} onCancel={actions.cancelEdit} />
      ) : (
        <div className="gs-card-text">
          {card.kind !== 'text' && <span className="gs-card-kind">{card.kind === 'note-ref' ? 'note' : 'link'}</span>}
          {shown || <span className="gs-card-empty">empty card</span>}
        </div>
      )}
      {SIDES.map(([side, position]) => (
        <Handle key={`${side}-s`} id={handleId(side, 'source')} type="source" position={position} isConnectable={actions.canEditMap} isConnectableEnd={false} />
      ))}
    </div>
  );
}

export const CardNode = memo(CardNodeView);

/**
 * A frame: a labelled, resizable region (the old canvas groups), purely visual. It is a backdrop:
 * its body lets clicks through to the graph, and only its label and border can be grabbed.
 */
function FrameNodeView({ data, selected }: NodeProps<FrameFlowNode>) {
  const { frame } = data;
  const actions = useNodeActions();
  const editing = actions.editing?.kind === 'frame' && actions.editing.id === frame.id;
  const color = cssColor(frame.color);
  return (
    <div className={`gs-frame${selected ? ' is-selected' : ''}`} data-frame-id={frame.id} style={color ? ({ '--gs-c': color } as React.CSSProperties) : undefined}>
      <NodeResizer
        isVisible={selected && actions.canEditMap}
        minWidth={80}
        minHeight={60}
        onResizeEnd={(_event, rect) => actions.resize('frame', frame.id, rect)}
      />
      {editing ? (
        <InlineText single initial={frame.label} label="Frame label" onCommit={(text) => actions.commitText('frame', frame.id, text)} onCancel={actions.cancelEdit} />
      ) : (
        <div
          className="gs-frame-label"
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (actions.canEditMap) actions.startEdit('frame', frame.id);
          }}
        >
          {frame.label || <span className="gs-card-empty">frame</span>}
        </div>
      )}
    </div>
  );
}

export const FrameNode = memo(FrameNodeView);
