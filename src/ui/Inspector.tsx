import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FALSIFIER_HEADING } from '../core/content';
import type { Intent } from '../core/edits';
import { sectionText, splitFrontmatter, type RelationField } from '../core/writes';
import type { EditOutcome } from '../core/perform';
import { RELATIONS, statusesFor, targetsOf, type Graph, type GraphNode } from '../core/schema';
import { titleOf } from './model';

export interface InspectorProps {
  graph: Graph;
  node: GraphNode;
  /** Perform an edit and show its outcome; null when the graph is read-only. */
  perform: ((intent: Intent) => Promise<EditOutcome>) | null;
  readNote?: (path: string) => Promise<string>;
  renderNote?: (el: HTMLElement, path: string) => () => void;
  onOpenNote?: (path: string, newTab: boolean) => void;
  onClose: () => void;
}

const FIELD_LABEL: Record<string, string> = {
  serves: 'Serves',
  'ultimately-serves': 'Ultimately serves',
  requires: 'Requires',
  next: 'Next sequel (on kill)',
  assumptions: 'Assumptions',
};

/** How the note is reached from the others: "Depended on by" for an assumption, "Served by", "Required by", "Sequel of". */
const INCOMING_LABEL: Record<string, string> = {
  assumption: 'Depended on by',
  serves: 'Served by',
  'ultimately-serves': 'Ultimately served by',
  requires: 'Required by',
  next: 'Sequel of',
};

const idOf = (n: GraphNode) => n.id ?? n.basename;

/**
 * The side panel for the selected note (plan Phase 6): its fields, its relations with add and
 * remove, a log entry, the note itself, and a way to open it in a split. Every change is an
 * intent for the host (`perform`); the panel holds no copy of the note, so it always shows the graph.
 */
export function Inspector({ graph, node, perform, readNote, renderNote, onOpenNote, onClose }: InspectorProps) {
  const editable = perform !== null;
  const statuses = statusesFor(node.type);
  const [bodyVersion, setBodyVersion] = useState(0);
  const run = async (intent: Intent) => {
    const outcome = await perform!(intent);
    if (outcome.ok) setBodyVersion((v) => v + 1);
    return outcome;
  };
  const date = node.type === 'bet' ? node.deadline : node.type === 'assumption' ? node.verifyBy : null;
  const nodeOf = (key: string) => graph.nodes.find((n) => n.key === key);

  return (
    <aside className="gs-inspector nowheel nopan nodrag" aria-label={`Inspector: ${idOf(node)}`} data-node-key={node.key}>
      <header className="gs-inspector-head">
        <div>
          <div className="gs-inspector-id">
            {idOf(node)} <span className="gs-inspector-type">{node.type}</span>
          </div>
          <div className="gs-inspector-title">{titleOf(node)}</div>
        </div>
        <button className="gs-inspector-close" onClick={onClose} aria-label="Close inspector" title="Close">
          ×
        </button>
      </header>

      <div className="gs-inspector-fields">
        {statuses && (
          <label>
            Status
            <select
              value={node.status ?? ''}
              disabled={!editable}
              onChange={(event) => void run({ kind: 'set-status', key: node.key, status: event.target.value })}
            >
              {node.status === null || !statuses.includes(node.status) ? <option value={node.status ?? ''}>{node.status ?? '(none)'}</option> : null}
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        )}
        {(node.type === 'bet' || node.type === 'assumption') && (
          <label>
            {node.type === 'bet' ? 'Deadline' : 'Verify by'}
            <input
              type="date"
              key={`${node.key}:${date ?? ''}`}
              defaultValue={date ? date.slice(0, 10) : ''}
              disabled={!editable}
              onBlur={(event) => event.target.value !== (date ? date.slice(0, 10) : '') && void run({ kind: 'set-date', key: node.key, value: event.target.value })}
            />
          </label>
        )}
        {node.type === 'bet' && (
          <TextField
            label="Expected result"
            fieldKey={`${node.key}:expected`}
            value={typeof node.frontmatter['expected-result'] === 'string' ? (node.frontmatter['expected-result'] as string) : ''}
            disabled={!editable}
            onSave={(value) => void run({ kind: 'set-text', key: node.key, field: 'expected-result', value })}
          />
        )}
        {node.type === 'assumption' && (
          <Falsifier node={node} readNote={readNote} version={bodyVersion} disabled={!editable} onSave={(value) => void run({ kind: 'set-text', key: node.key, field: 'falsifier', value })} />
        )}
      </div>

      {RELATIONS.filter((rule) => targetsOf(rule, node.type)).map((rule) => {
        const field = rule.field as RelationField;
        const allowed = targetsOf(rule, node.type)!;
        const linked = graph.edges.filter((e) => e.kind === rule.kind && e.from === node.key);
        const linkedKeys = new Set(linked.map((e) => e.to));
        const options = graph.nodes.filter((n) => n.key !== node.key && allowed.includes(n.type) && !linkedKeys.has(n.key));
        const full = field === 'next' && linked.length > 0;
        return (
          <section key={field} className="gs-inspector-relation" data-field={field}>
            <h4>{FIELD_LABEL[field]}</h4>
            <ul>
              {linked.map((edge) => {
                const target = nodeOf(edge.to);
                return (
                  <li key={edge.key}>
                    <span>{target ? `${idOf(target)} ${titleOf(target)}` : edge.to}</span>
                    <button
                      aria-label={`Remove ${FIELD_LABEL[field]} ${target ? idOf(target) : edge.to}`}
                      disabled={!editable}
                      onClick={() => void run({ kind: 'remove-relation', holder: node.key, field, target: edge.to })}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
              {linked.length === 0 && <li className="gs-inspector-none">none</li>}
            </ul>
            {editable && !full && options.length > 0 && (
              <select
                className="gs-inspector-add"
                aria-label={`Add ${FIELD_LABEL[field]}`}
                value=""
                onChange={(event) => event.target.value && void run({ kind: 'add-relation', holder: node.key, field, target: event.target.value })}
              >
                <option value="">+ add…</option>
                {options.map((n) => (
                  <option key={n.key} value={n.key}>
                    {idOf(n)} {titleOf(n)}
                  </option>
                ))}
              </select>
            )}
          </section>
        );
      })}

      <Incoming graph={graph} node={node} />

      {editable && <LogEntry onAdd={(text) => run({ kind: 'log', key: node.key, text })} />}

      <section className="gs-inspector-note">
        <h4>
          Note
          {onOpenNote && (
            <button className="gs-inspector-open" onClick={() => onOpenNote(node.path, true)}>
              Open in split
            </button>
          )}
        </h4>
        <NoteBody path={node.path} readNote={readNote} renderNote={renderNote} version={bodyVersion} />
      </section>
    </aside>
  );
}

/** Who points at this note: read-only, computed from the graph, never stored (D2). */
function Incoming({ graph, node }: { graph: Graph; node: GraphNode }) {
  const groups = new Map<string, GraphNode[]>();
  for (const edge of graph.edges) {
    if (edge.to !== node.key) continue;
    const from = graph.nodes.find((n) => n.key === edge.from);
    if (from) groups.set(edge.kind, [...(groups.get(edge.kind) ?? []), from]);
  }
  if (!groups.size) return null;
  return (
    <section className="gs-inspector-incoming">
      {Array.from(groups, ([kind, nodes]) => (
        <div key={kind}>
          <h4>{INCOMING_LABEL[kind]}</h4>
          <p>{nodes.map((n) => `${idOf(n)} ${titleOf(n)}`).join(', ')}</p>
        </div>
      ))}
    </section>
  );
}

/** A text field that saves when it is left, if the text changed, and takes the graph's value back when that changes. */
function TextField({ label, fieldKey, value, disabled, onSave }: { label: string; fieldKey: string; value: string; disabled: boolean; onSave: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea
        key={`${fieldKey}:${value}`}
        defaultValue={value}
        rows={2}
        disabled={disabled}
        onBlur={(event) => event.target.value.trim() !== value.trim() && onSave(event.target.value)}
      />
    </label>
  );
}

/** The falsifier lives in the note's body: read it from there. */
function Falsifier({ node, readNote, version, disabled, onSave }: { node: GraphNode; readNote?: InspectorProps['readNote']; version: number; disabled: boolean; onSave: (value: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    readNote?.(node.path).then(
      (note) => !cancelled && setText(sectionText(splitFrontmatter(note).body, FALSIFIER_HEADING) ?? ''),
      () => !cancelled && setText('')
    );
    return () => {
      cancelled = true;
    };
  }, [node.path, readNote, version]);
  if (text === null) return readNote ? <p className="gs-inspector-none">Reading the falsifier…</p> : null;
  // The placeholder the template writes is not a falsifier yet.
  const shown = text.startsWith('*') && text.endsWith('*') ? '' : text;
  return <TextField label="How I'd know it's false" fieldKey={`${node.key}:falsifier`} value={shown} disabled={disabled} onSave={onSave} />;
}

function LogEntry({ onAdd }: { onAdd: (text: string) => Promise<EditOutcome> }) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    const outcome = await onAdd(text);
    if (outcome.ok) setText('');
  };
  return (
    <section className="gs-inspector-log">
      <h4>Log</h4>
      <div className="gs-inspector-log-row">
        <input
          type="text"
          value={text}
          placeholder="+ log entry"
          aria-label="Log entry"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            event.stopPropagation();
            if (event.key === 'Enter') void submit();
          }}
        />
        <button onClick={() => void submit()} disabled={!text.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}

/** The note itself: rendered by the host (Obsidian's reading view) when it can, else as text. */
function NoteBody({ path, readNote, renderNote, version }: { path: string; readNote?: InspectorProps['readNote']; renderNote?: InspectorProps['renderNote']; version: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (renderNote) {
      const target = el.current;
      if (!target) return;
      target.replaceChildren();
      return renderNote(target, path);
    }
    let cancelled = false;
    readNote?.(path).then(
      (note) => !cancelled && setText(splitFrontmatter(note).body),
      () => !cancelled && setText(null)
    );
    return () => {
      cancelled = true;
    };
  }, [path, renderNote, readNote, version]);
  return renderNote || !readNote ? <div className="gs-inspector-body markdown-rendered" ref={el} /> : <pre className="gs-inspector-body gs-inspector-text">{text ?? ''}</pre>;
}
