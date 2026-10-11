import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { GsCard, GsFrame, GsLink, GsOp } from '../core/gsmap';
import type { MenuItem } from './GraphMenus';
import { bottomInset, cardNodeId, endpointNodeId, type Peek } from './model';

/**
 * The graph's phone layout (plan Phase 8b, D22; the design is `docs/design/phone/`). Two kinds of
 * surface: modal sheets (a scrim, and they cover the toolbar and Obsidian's navbar, so they are put
 * on the document's body) and docked cards (no scrim, the graph still pans; they stay inside the
 * graph's box, above the navbar). Placement lives in `graph.css`, driven by the insets and the
 * orientation `usePhoneFrame` writes on the graph's box.
 */

export type Orientation = 'portrait' | 'landscape';

/** Obsidian's mobile navigation bar. Measured at runtime; not public API, so unverified on a device. */
export const NAVBAR_SELECTOR = '.mobile-navbar';

export interface PhoneFrame {
  orientation: Orientation;
  /** The graph's box height in pixels: a portrait sheet is at most 78% of it. */
  viewHeight: number;
  /** Where modal sheets go: the body of the graph's document. */
  body: HTMLElement | null;
}

/**
 * Watch the graph's box on a phone: its orientation (from its own size, not the screen's), and the
 * bottom inset that clears Obsidian's navbar, written as `--gs-inset-bottom` (the CSS fallback stays
 * when the navbar can't be measured). Measured again on resize, rotation and keyboard show or hide.
 */
export function usePhoneFrame(ref: RefObject<HTMLElement | null>, on: boolean): PhoneFrame {
  const [frame, setFrame] = useState<PhoneFrame>({ orientation: 'portrait', viewHeight: 0, body: null });
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const doc = el.ownerDocument;
    const win = doc.defaultView ?? window;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const orientation: Orientation = box.width > box.height ? 'landscape' : 'portrait';
      setFrame((f) => (f.orientation === orientation && f.viewHeight === box.height && f.body === doc.body ? f : { orientation, viewHeight: box.height, body: doc.body }));
      el.dataset.orientation = orientation;
      const inset = bottomInset(box, doc.querySelector(NAVBAR_SELECTOR)?.getBoundingClientRect() ?? null);
      if (inset === null) el.style.removeProperty('--gs-inset-bottom');
      else el.style.setProperty('--gs-inset-bottom', `${inset}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const navbar = doc.querySelector(NAVBAR_SELECTOR);
    if (navbar) observer.observe(navbar);
    win.addEventListener('resize', measure);
    win.addEventListener('orientationchange', measure);
    win.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      win.removeEventListener('resize', measure);
      win.removeEventListener('orientationchange', measure);
      win.visualViewport?.removeEventListener('resize', measure);
      delete el.dataset.orientation;
      el.style.removeProperty('--gs-inset-bottom');
    };
  }, [ref, on]);
  return frame;
}

/** A long-press: 500 ms with less than 8 px of movement. */
export const LONG_PRESS_MS = 500;
const PRESS_SLOP = 8;
/** Two taps on the same node within this long, and this close, are a double-tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 24;

/** How long after a gesture the browser's own click (from the same touch) is still swallowed. */
const GHOST_CLICK_MS = 800;

/**
 * Touch gestures on the graph's nodes (by their React Flow id): a long-press and a double-tap. A
 * pointer timer on the nodes, since `dblclick` doesn't fire reliably after taps. The click the
 * browser sends after the touch that made a gesture is swallowed wherever it lands: it would
 * otherwise count as a tap on the node, or on the scrim of the sheet the gesture just opened (and
 * close it again). Mouse pointers are left alone.
 */
export function useTouchGestures(
  ref: RefObject<HTMLElement | null>,
  on: boolean,
  handlers: { longPress: (id: string) => void; doubleTap: (id: string) => void }
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let press: { id: string; x: number; y: number; pointer: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let lastTap: { id: string; at: number; x: number; y: number } | null = null;
    let swallowUntil = 0;
    /** The pointer whose long-press fired, until it is lifted. */
    let held: number | null = null;
    const doc = el.ownerDocument;
    const nodeId = (target: EventTarget | null) => (target instanceof Element ? target.closest('.react-flow__node')?.getAttribute('data-id') ?? null : null);
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const down = (event: PointerEvent) => {
      cancel();
      // A second finger (a pinch) is no press.
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      const id = nodeId(event.target);
      if (!id) return;
      const at = { id, x: event.clientX, y: event.clientY, pointer: event.pointerId };
      press = {
        ...at,
        timer: setTimeout(() => {
          press = null;
          lastTap = null;
          // Until the finger is up, and a moment after (`lifted`); never for long, should no lift come.
          swallowUntil = Date.now() + 10_000;
          held = at.pointer;
          latest.current.longPress(id);
        }, LONG_PRESS_MS),
      };
    };
    const move = (event: PointerEvent) => {
      if (press && event.pointerId === press.pointer && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= PRESS_SLOP) cancel();
    };
    /** True when this pointer's long-press fired: the gesture is over, and its click is still to come. */
    const lifted = (event: PointerEvent) => {
      if (held !== event.pointerId) return false;
      held = null;
      swallowUntil = Date.now() + GHOST_CLICK_MS;
      return true;
    };
    const cancelled = (event: PointerEvent) => {
      lifted(event);
      cancel();
    };
    const up = (event: PointerEvent) => {
      if (lifted(event)) return;
      if (!press || event.pointerId !== press.pointer) return;
      const { id } = press;
      cancel();
      const now = Date.now();
      if (lastTap && lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP) {
        lastTap = null;
        swallowUntil = now + GHOST_CLICK_MS;
        latest.current.doubleTap(id);
      } else lastTap = { id, at: now, x: event.clientX, y: event.clientY };
    };
    const click = (event: MouseEvent) => {
      if (Date.now() > swallowUntil) return;
      swallowUntil = 0;
      event.stopPropagation();
      event.preventDefault();
    };
    // The iOS callout and text selection a long-press would bring up.
    const noSelect = (event: Event) => nodeId(event.target) && event.preventDefault();
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', cancelled, true);
    doc.addEventListener('click', click, true);
    el.addEventListener('selectstart', noSelect, true);
    return () => {
      cancel();
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', cancelled, true);
      doc.removeEventListener('click', click, true);
      el.removeEventListener('selectstart', noSelect, true);
    };
  }, [ref, on]);
}

/** How far a sheet must be swiped (down in portrait, right in landscape) to close. */
const SWIPE_CLOSE = 70;

/** Close on Escape (a keyboard on the dev page or a tablet-style keyboard), before anything else hears it. */
function useEscape(doc: Document | null | undefined, onClose: () => void) {
  useEffect(() => {
    if (!doc) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    doc.addEventListener('keydown', key, true);
    return () => doc.removeEventListener('keydown', key, true);
  }, [doc, onClose]);
}

/** The layer modal surfaces live in: on the body, above Obsidian's navbar, with the graph's classes (its CSS applies). */
function Layer({ frame, children }: { frame: PhoneFrame; children: ReactNode }) {
  if (!frame.body) return null;
  const style = { '--gs-view-height': `${frame.viewHeight}px` } as CSSProperties;
  return createPortal(
    <div className="gs-graph gs-phone-layer" data-orientation={frame.orientation} style={style}>
      {children}
    </div>,
    frame.body
  );
}

/**
 * A modal sheet: details, smells, actions forms, confirms. Portrait: a bottom sheet, at most 78% of
 * the view's height; landscape: a full-height sheet on the right. A tap on the scrim, a swipe (down,
 * or right), Escape or the close button closes it. The header and footer stay; the body scrolls, and
 * its overscroll never pans the graph. A focused field grows the sheet to full height and is scrolled
 * into view, above the keyboard.
 */
export function Sheet({
  frame,
  label,
  onClose,
  head,
  foot,
  children,
  className,
}: {
  frame: PhoneFrame;
  label: string;
  onClose: () => void;
  head?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [full, setFull] = useState(false);
  const swipe = useRef<{ x: number; y: number; pointer: number } | null>(null);
  useEscape(frame.body?.ownerDocument, onClose);
  const landscape = frame.orientation === 'landscape';
  return (
    <Layer frame={frame}>
      <button type="button" className="gs-scrim" aria-label="Close" onClick={onClose} />
      <section
        className={`gs-sheet${full ? ' is-full' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onFocus={(event) => {
          const field = event.target;
          if (!(field instanceof HTMLElement) || !field.matches('input:not([type="checkbox"]):not([type="radio"]), textarea')) return;
          setFull(true);
          // After the sheet has grown and the keyboard is up.
          setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFull(false);
        }}
      >
        <div
          className="gs-sheet-grip"
          onPointerDown={(event) => (swipe.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId })}
          onPointerUp={(event) => {
            const start = swipe.current;
            swipe.current = null;
            if (!start || start.pointer !== event.pointerId) return;
            const [dx, dy] = [event.clientX - start.x, event.clientY - start.y];
            if (landscape ? dx > SWIPE_CLOSE && dx > Math.abs(dy) : dy > SWIPE_CLOSE && dy > Math.abs(dx)) onClose();
          }}
        >
          <div className="gs-sheet-grab" aria-hidden="true">
            <span />
          </div>
          <header className="gs-sheet-head">
            <div className="gs-sheet-top">
              <div className="gs-sheet-heading">{head ?? <span className="gs-sheet-title">{label}</span>}</div>
              <button type="button" className="gs-icon-button" aria-label={`Close ${label}`} onClick={onClose}>
                <Icon name="close" />
              </button>
            </div>
          </header>
        </div>
        <div className="gs-sheet-body nowheel">{children}</div>
        {foot && <footer className="gs-sheet-foot">{foot}</footer>}
      </section>
    </Layer>
  );
}

/**
 * The actions sheet: a node's menu (the right-click menu on a desktop) as rows, and a Cancel. An item
 * that can't be used now says why under its label, since a phone has no tooltips.
 */
export function ActionSheet({ frame, title, items, onClose }: { frame: PhoneFrame; title: ReactNode; items: readonly MenuItem[]; onClose: () => void }) {
  useEscape(frame.body?.ownerDocument, onClose);
  return (
    <Layer frame={frame}>
      <button type="button" className="gs-scrim" aria-label="Close" onClick={onClose} />
      <div className="gs-acts" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Actions'}>
        <div className="gs-acts-group">
          <div className="gs-acts-head">{title}</div>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`gs-act${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled !== undefined}
              onClick={() => {
                onClose();
                item.run();
              }}
            >
              <span>{item.label}</span>
              {item.disabled && <span className="gs-act-why">{item.disabled}</span>}
            </button>
          ))}
        </div>
        <div className="gs-acts-group">
          <button type="button" className="gs-act gs-act--cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Layer>
  );
}

/** A card docked in the graph (the peek card, the review walk): no scrim, so the graph still pans and taps. */
export function DockCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`gs-dock nowheel${className ? ` ${className}` : ''}`} role="region" aria-label={label}>
      {children}
    </div>
  );
}

/** The peek card: kind · id · status and date, the title, the first smell; Details · Open note · ⋯. */
export function PeekCard({ peek, onDetails, onOpenNote, onMore }: { peek: Peek; onDetails: () => void; onOpenNote?: () => void; onMore?: () => void }) {
  return (
    <DockCard label="Selected node" className="gs-peek">
      <button type="button" className="gs-peek-body" onClick={onDetails} aria-label={`Show details for ${peek.id || peek.title}`}>
        <span className="gs-dock-grab" aria-hidden="true">
          <span />
        </span>
        <span className="gs-peek-row">
          <span className={`gs-pill ${peek.tone}`}>{peek.kind}</span>
          {peek.id && <span className="gs-peek-id">{peek.id}</span>}
          <span className="gs-peek-meta">{peek.meta}</span>
        </span>
        <span className="gs-peek-title">{peek.title}</span>
        {peek.smell && (
          <span className="gs-peek-smell">
            <Icon name="alert" />
            {peek.smell}
          </span>
        )}
      </button>
      <div className="gs-dock-buttons">
        <button type="button" className="mod-cta" onClick={onDetails}>
          Details
        </button>
        {onOpenNote && (
          <button type="button" onClick={onOpenNote}>
            Open note
          </button>
        )}
        {onMore && (
          <button type="button" className="gs-icon-button" aria-label="More actions" onClick={onMore}>
            <Icon name="more" />
          </button>
        )}
      </div>
    </DockCard>
  );
}

/**
 * The phone toolbar: Fit · Smells (count) · Review walk · ⋯. A row along the top in portrait, an
 * icon rail on the left in landscape (the labels hide, `graph.css`). React Flow's controls are hidden
 * on a phone; ⋯ holds the rest.
 */
export function PhoneToolbar({
  smells,
  issues,
  walking,
  editLayout,
  onFit,
  onSmells,
  onWalk,
  onMore,
  onEditDone,
}: {
  smells: number;
  issues: number;
  walking: boolean;
  editLayout: boolean;
  onFit: () => void;
  onSmells: () => void;
  onWalk: () => void;
  onMore: () => void;
  onEditDone: () => void;
}) {
  return (
    <div className="gs-phone-toolbar" role="toolbar" aria-label="Graph">
      <button type="button" className="gs-tool" aria-label="Fit view" onClick={onFit}>
        <Icon name="fit" />
      </button>
      <button type="button" className="gs-tool gs-tool--smells" aria-label={`Smells, ${smells}`} onClick={onSmells}>
        <Icon name="alert" />
        <span className="gs-tool-label">Smells</span>
        <span className="gs-count">{smells}</span>
      </button>
      <button
        type="button"
        className={`gs-tool${walking ? '' : ' gs-tool--go'}`}
        aria-label={walking ? 'End walk' : 'Review walk'}
        aria-pressed={walking}
        onClick={onWalk}
      >
        <Icon name={walking ? 'close' : 'walk'} />
        <span className="gs-tool-label">{walking ? 'End walk' : 'Review walk'}</span>
      </button>
      {/* The graph's issues are under ⋯ (the row has no room for a fifth button); the badge counts them. */}
      <button type="button" className="gs-tool gs-tool--more" aria-label="More graph options" onClick={onMore}>
        <Icon name="more" />
        {issues > 0 && (
          <span className="gs-count gs-count--issues" aria-hidden="true">
            {issues}
          </span>
        )}
      </button>
      {editLayout && (
        <button type="button" className="gs-tool gs-tool--editing" aria-label="Done editing layout" onClick={onEditDone}>
          <Icon name="move" />
          <span className="gs-tool-label">Done</span>
        </button>
      )}
    </div>
  );
}

/**
 * The details sheet of a free card or a frame (O4: on a phone they are edited here, not in place):
 * a text card's text, a frame's label, and a card's free links, removed or added. Text is saved when
 * the field is left, and again by the sheet when it closes (`draft`), which also deletes a text card
 * left empty, as in place.
 */
export function FreeItemDetails({
  item,
  links,
  targets,
  nameOf,
  onOp,
  draft,
  editable,
}: {
  item: { kind: 'card'; card: GsCard } | { kind: 'frame'; frame: GsFrame };
  links: readonly GsLink[];
  /** What a card can be linked to: React Flow ids and their names. */
  targets: readonly { id: string; label: string }[];
  /** The name of a link's other end, by React Flow id. */
  nameOf: (id: string) => string;
  onOp: (op: GsOp) => void;
  /** Where the field's text is kept while it is typed. */
  draft: { current: string | null };
  editable: boolean;
}) {
  if (item.kind === 'frame') {
    const { frame } = item;
    return (
      <div className="gs-inspector-fields">
        <label>
          Label
          <input
            type="text"
            key={frame.id}
            defaultValue={frame.label}
            disabled={!editable}
            onChange={(event) => (draft.current = event.target.value)}
            onBlur={(event) => event.target.value.trim() !== frame.label && onOp({ op: 'put-frame', frame: { ...frame, label: event.target.value.trim() } })}
          />
        </label>
      </div>
    );
  }
  const { card } = item;
  const self = cardNodeId(card.id);
  const mine = links.filter((l) => endpointNodeId(l.from) === self || endpointNodeId(l.to) === self);
  const linked = new Set(mine.map((l) => (endpointNodeId(l.from) === self ? endpointNodeId(l.to) : endpointNodeId(l.from))));
  const options = targets.filter((t) => t.id !== self && !linked.has(t.id));
  return (
    <>
      <div className="gs-inspector-fields">
        {card.kind === 'text' ? (
          <label>
            Text
            <textarea
              key={card.id}
              defaultValue={card.text}
              rows={3}
              disabled={!editable}
              autoFocus={!card.text.trim()}
              onChange={(event) => (draft.current = event.target.value)}
              onBlur={(event) => event.target.value.trim() && event.target.value !== card.text && onOp({ op: 'put-card', card: { ...card, text: event.target.value } })}
            />
          </label>
        ) : (
          <p className="gs-inspector-none">{card.kind === 'note-ref' ? card.file : card.url}</p>
        )}
      </div>
      <section className="gs-inspector-relation" data-field="links">
        <h4>Links</h4>
        <ul>
          {mine.map((link) => {
            const other = endpointNodeId(link.from) === self ? endpointNodeId(link.to) : endpointNodeId(link.from);
            return (
              <li key={link.id}>
                <span>{nameOf(other)}</span>
                <button aria-label={`Remove link to ${nameOf(other)}`} disabled={!editable} onClick={() => onOp({ op: 'delete-link', id: link.id })}>
                  ×
                </button>
              </li>
            );
          })}
          {mine.length === 0 && <li className="gs-inspector-none">none</li>}
        </ul>
        {editable && options.length > 0 && (
          <select
            className="gs-inspector-add"
            aria-label="Add link"
            value=""
            onChange={(event) => {
              const to = event.target.value;
              if (!to) return;
              const end = to.startsWith('card:') ? { card: to.slice('card:'.length) } : { note: to };
              onOp({ op: 'put-link', link: { id: freshLinkId(links), from: { card: card.id }, to: end } });
            }}
          >
            <option value="">+ link to…</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </section>
    </>
  );
}

function freshLinkId(links: readonly GsLink[]): string {
  const taken = new Set(links.map((l) => l.id));
  for (;;) {
    const id = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    if (!taken.has(id)) return id;
  }
}

const ICONS: Record<string, ReactNode> = {
  close: <path d="M18 6 6 18M6 6l12 12" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  fit: <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />,
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </>
  ),
  walk: <path d="m6 4 14 8-14 8z" />,
  move: <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />,
  prev: <path d="m15 18-6-6 6-6" />,
  next: <path d="m9 18 6-6-6-6" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
};

/** A 24×24 stroke icon in the text colour. */
export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="gs-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
