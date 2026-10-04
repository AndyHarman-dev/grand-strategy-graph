import type { ReactNode } from 'react';
import type { GsCard, GsFrame, GsLink, GsOp } from '../core/gsmap';
import { COLOR_CHOICES, cssColor } from './model';

export type EditedItem = { kind: 'card'; item: GsCard } | { kind: 'frame'; item: GsFrame } | { kind: 'link'; item: GsLink };

/** One option of an icon group: the value it sets, its name (also its tooltip), and its picture. */
interface IconOption {
  value: string;
  label: string;
  icon: ReactNode;
}

/** A 24×24 stroke icon, drawn in the text colour like Obsidian's own. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const BORDERS: IconOption[] = [
  { value: '', label: 'Solid border', icon: <Icon><rect x="4" y="5" width="16" height="14" rx="2" /></Icon> },
  { value: 'dashed', label: 'Dashed border', icon: <Icon><rect x="4" y="5" width="16" height="14" rx="2" strokeDasharray="3 3" /></Icon> },
  { value: 'invisible', label: 'No border', icon: <Icon><rect x="4" y="5" width="16" height="14" rx="2" strokeDasharray="1 3" opacity={0.5} /></Icon> },
];

const SHAPES: IconOption[] = [
  { value: '', label: 'Box', icon: <Icon><rect x="4" y="6" width="16" height="12" rx="2" /></Icon> },
  { value: 'diamond', label: 'Diamond', icon: <Icon><path d="M12 3 21 12 12 21 3 12Z" /></Icon> },
];

const LINES: IconOption[] = [
  { value: '', label: 'Solid line', icon: <Icon><path d="M3 12h18" /></Icon> },
  { value: 'short-dashed', label: 'Dashed line', icon: <Icon><path d="M3 12h18" strokeDasharray="3 3" /></Icon> },
  { value: 'long-dashed', label: 'Long dashes', icon: <Icon><path d="M3 12h18" strokeDasharray="9 4" /></Icon> },
  { value: 'dotted', label: 'Dotted line', icon: <Icon><path d="M3 12h18" strokeDasharray="0.1 4" /></Icon> },
];

/** Arrow ends, as on a canvas: `from` is an arrow at the start, `to` one at the end. */
const ARROWS: IconOption[] = [
  { value: '', label: 'No arrows', icon: <Icon><path d="M4 12h16" /></Icon> },
  { value: 'to', label: 'Arrow at the end', icon: <Icon><path d="M4 12h16M15 7l5 5-5 5" /></Icon> },
  { value: 'from', label: 'Arrow at the start', icon: <Icon><path d="M4 12h16M9 7l-5 5 5 5" /></Icon> },
  { value: 'fromto', label: 'Arrows at both ends', icon: <Icon><path d="M4 12h16M15 7l5 5-5 5M9 7l-5 5 5 5" /></Icon> },
];

/** A row of icon buttons that works as one radio group, like the canvas's style menus. */
function IconChoices({ label, options, value, onChange }: { label: string; options: IconOption[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="gs-icon-choices" role="radiogroup" aria-label={label}>
      <span className="gs-icon-choices-label">{label}</span>
      {options.map((option) => (
        <button
          key={option.label}
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          className={`gs-icon-choice${value === option.value ? ' is-active' : ''}`}
          onClick={() => value !== option.value && onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

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
          <IconChoices
            label="Border"
            options={BORDERS}
            value={edited.item.style?.border ?? ''}
            onChange={(border) => onOp({ op: 'put-card', card: clean({ ...edited.item, style: withStyle(edited.item.style, 'border', border || null) }) })}
          />
          <IconChoices
            label="Shape"
            options={SHAPES}
            value={edited.item.style?.shape ?? ''}
            onChange={(shape) => onOp({ op: 'put-card', card: clean({ ...edited.item, style: withStyle(edited.item.style, 'shape', shape || null) }) })}
          />
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
          <IconChoices
            label="Line"
            options={LINES}
            value={edited.item.style?.path ?? ''}
            onChange={(path) => onOp({ op: 'put-link', link: clean({ ...edited.item, style: withStyle(edited.item.style, 'path', path || null) }) })}
          />
          <IconChoices
            label="Arrows"
            options={ARROWS}
            value={`${edited.item.fromEnd === 'arrow' ? 'from' : ''}${edited.item.toEnd === 'none' ? '' : 'to'}`}
            onChange={(ends) =>
              onOp({
                op: 'put-link',
                link: clean({ ...edited.item, fromEnd: ends.includes('from') ? ('arrow' as const) : undefined, toEnd: ends.includes('to') ? undefined : ('none' as const) }),
              })
            }
          />
        </>
      )}
      <div className="gs-quick-create-buttons">
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
