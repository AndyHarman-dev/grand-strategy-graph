import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Intent } from '../core/edits';
import type { EditOutcome } from '../core/perform';
import type { GraphNode } from '../core/schema';

export interface MenuItem {
  label: string;
  /** Why the item can't be used now (shown as its tooltip, and the item is off). */
  disabled?: string;
  run: () => void;
}

/** A small menu at a point of the graph (relative to the graph's top-left corner). Escape, a click elsewhere or a choice closes it. */
export function PopupMenu({ at, items, onClose, label }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const doc = ref.current?.ownerDocument ?? document;
    doc.addEventListener('pointerdown', close, true);
    doc.addEventListener('keydown', close, true);
    return () => {
      doc.removeEventListener('pointerdown', close, true);
      doc.removeEventListener('keydown', close, true);
    };
  }, [onClose]);
  return (
    <ul className="gs-menu" role="menu" aria-label={label} ref={ref} style={{ left: at.x, top: at.y }}>
      {items.map((item) => (
        <li key={item.label} role="none">
          <button
            role="menuitem"
            disabled={item.disabled !== undefined}
            title={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A message that fades: the outcome of the last edit. */
export function Toast({ outcome, onDone }: { outcome: (EditOutcome & { id: number }) | null; onDone: () => void }) {
  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(onDone, outcome.ok ? 4000 : 9000);
    return () => clearTimeout(timer);
  }, [outcome, onDone]);
  if (!outcome) return null;
  return (
    <div className={`gs-toast${outcome.ok ? '' : ' is-error'}`} role="status" aria-live="polite">
      {outcome.message}
    </div>
  );
}

export type QuickCreateKind =
  | { kind: 'bet'; heading: string; serves: string[]; sequelOf?: string }
  | { kind: 'assumption'; heading: string; dependents: string[] };

/**
 * The small form behind "New bet serving this", "New sequel bet" and "Add assumption": the same
 * fields as the creation dialogs, minus the pickers (what the new note is linked to is already
 * known from where it was asked). Stays open, with the reason, when the edit is refused.
 */
export function QuickCreate({ request, anchor, perform, onClose }: { request: QuickCreateKind; anchor: GraphNode; perform: (intent: Intent) => Promise<EditOutcome>; onClose: () => void }) {
  const [values, setValues] = useState({ title: '', x: '', y: '', z: '', deadline: '', statement: '', falsifier: '', verifyBy: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const intent: Intent =
      request.kind === 'bet'
        ? { kind: 'new-bet', form: { title: values.title, x: values.x, y: values.y, z: values.z, deadline: values.deadline }, serves: request.serves, sequelOf: request.sequelOf }
        : { kind: 'new-assumption', form: { statement: values.statement, falsifier: values.falsifier, verifyBy: values.verifyBy }, dependents: request.dependents };
    const outcome = await perform(intent);
    setBusy(false);
    if (outcome.ok) onClose();
    else setError(outcome.message);
  };

  return (
    <form className="gs-quick-create nowheel nopan nodrag" aria-label={request.heading} onSubmit={submit} onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <h3>{request.heading}</h3>
      <p className="gs-quick-create-anchor">
        {request.kind === 'bet' && request.sequelOf ? 'Sequel of' : request.kind === 'bet' ? 'Serves' : 'Depended on by'} {anchor.id ?? anchor.basename}
      </p>
      {request.kind === 'bet' ? (
        <>
          <label>
            Title
            <input ref={first} value={values.title} onChange={set('title')} required />
          </label>
          <label>
            X — continuing to do
            <input value={values.x} onChange={set('x')} />
          </label>
          <label>
            Y — will produce (defaults to the title)
            <input value={values.y} onChange={set('y')} />
          </label>
          <label>
            Z — within timeframe
            <input value={values.z} onChange={set('z')} />
          </label>
          <label>
            Deadline (optional)
            <input type="date" value={values.deadline} onChange={set('deadline')} />
          </label>
        </>
      ) : (
        <>
          <label>
            The assumption
            <input ref={first} value={values.statement} onChange={set('statement')} required />
          </label>
          <label>
            How I'd know it's false
            <input value={values.falsifier} onChange={set('falsifier')} />
          </label>
          <label>
            Verify by (optional)
            <input type="date" value={values.verifyBy} onChange={set('verifyBy')} />
          </label>
        </>
      )}
      {error && <p className="gs-quick-create-error" role="alert">{error}</p>}
      <div className="gs-quick-create-buttons">
        <button type="submit" className="mod-cta" disabled={busy}>
          Create
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
