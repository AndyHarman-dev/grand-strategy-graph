import type { GsCard, GsFrame, GsLink, GsOp } from '../core/gsmap';
import { COLOR_CHOICES, cssColor } from './model';

export type EditedItem = { kind: 'card'; item: GsCard } | { kind: 'frame'; item: GsFrame } | { kind: 'link'; item: GsLink };

const LINE_STYLES: { value: string | null; label: string }[] = [
  { value: null, label: 'solid' },
  { value: 'short-dashed', label: 'dashed' },
  { value: 'long-dashed', label: 'long dashes' },
  { value: 'dotted', label: 'dotted' },
];

/** `style` with `key` set, or taken out when `value` is null; null when nothing is left. */
function withStyle(style: Record<string, string> | undefined, key: string, value: string | null): Record<string, string> | undefined {
  const next = { ...style };
  if (value === null) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

/** Drop the key from an object when the value is undefined, so a cleared option leaves no trace in the file. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Colour and look of a free card, frame or link, edited live: each change is one op for the map.
 * Links carry no strategy meaning, so their style is free (plan Phase 7): label, line, ends.
 */
export function ItemEditor({ edited, onOp, onClose }: { edited: EditedItem; onOp: (op: GsOp) => void; onClose: () => void }) {
  const colorOf = (color: string | null) => {
    const value = color ?? undefined;
    if (edited.kind === 'card') onOp({ op: 'put-card', card: clean({ ...edited.item, color: value }) });
    else if (edited.kind === 'frame') onOp({ op: 'put-frame', frame: clean({ ...edited.item, color: value }) });
    else onOp({ op: 'put-link', link: clean({ ...edited.item, color: value }) });
  };
  const heading = edited.kind === 'card' ? 'Card style' : edited.kind === 'frame' ? 'Frame style' : 'Link style';
  const current = edited.item.color ?? null;
  return (
    <div className="gs-item-editor nowheel nopan nodrag" role="dialog" aria-label={heading} onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <h3>{heading}</h3>
      <div className="gs-swatches" role="radiogroup" aria-label="Colour">
        {COLOR_CHOICES.map(({ value, label }) => (
          <button
            key={label}
            role="radio"
            aria-checked={current === value}
            aria-label={label}
            title={label}
            className={`gs-swatch${current === value ? ' is-active' : ''}${value === null ? ' is-none' : ''}`}
            style={value ? { background: cssColor(value) } : undefined}
            onClick={() => colorOf(value)}
          />
        ))}
      </div>
      {edited.kind === 'card' && (
        <>
          <label>
            Border
            <select
              value={edited.item.style?.border ?? ''}
              onChange={(event) => onOp({ op: 'put-card', card: clean({ ...edited.item, style: withStyle(edited.item.style, 'border', event.target.value || null) }) })}
            >
              <option value="">solid</option>
              <option value="dashed">dashed</option>
              <option value="invisible">none</option>
            </select>
          </label>
          <label>
            Shape
            <select
              value={edited.item.style?.shape ?? ''}
              onChange={(event) => onOp({ op: 'put-card', card: clean({ ...edited.item, style: withStyle(edited.item.style, 'shape', event.target.value || null) }) })}
            >
              <option value="">box</option>
              <option value="diamond">diamond</option>
            </select>
          </label>
        </>
      )}
      {edited.kind === 'link' && (
        <>
          <label>
            Label
            <input
              key={edited.item.id}
              type="text"
              defaultValue={edited.item.label ?? ''}
              onKeyDown={(event) => event.stopPropagation()}
              onBlur={(event) => {
                const label = event.target.value.trim();
                if (label !== (edited.item.label ?? '')) onOp({ op: 'put-link', link: clean({ ...edited.item, label: label || undefined }) });
              }}
            />
          </label>
          <label>
            Line
            <select
              value={edited.item.style?.path ?? ''}
              onChange={(event) => onOp({ op: 'put-link', link: clean({ ...edited.item, style: withStyle(edited.item.style, 'path', event.target.value || null) }) })}
            >
              {LINE_STYLES.map(({ value, label }) => (
                <option key={label} value={value ?? ''}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Arrows
            <select
              value={`${edited.item.fromEnd === 'arrow' ? 'from' : ''}${edited.item.toEnd === 'none' ? '' : 'to'}`}
              onChange={(event) => {
                const both = event.target.value;
                onOp({
                  op: 'put-link',
                  link: clean({ ...edited.item, fromEnd: both.includes('from') ? ('arrow' as const) : undefined, toEnd: both.includes('to') ? undefined : ('none' as const) }),
                });
              }}
            >
              <option value="to">at the end</option>
              <option value="fromto">both ends</option>
              <option value="from">at the start</option>
              <option value="">none</option>
            </select>
          </label>
        </>
      )}
      <div className="gs-quick-create-buttons">
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
