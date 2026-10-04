import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Intent } from '../core/edits';
import type { GraphState } from '../core/graph-session';
import type { GsPosition } from '../core/gsmap';
import type { EditOutcome } from '../core/perform';
import type { Graph } from '../core/schema';
import { StrategyGraph } from './StrategyGraph';

export interface GraphHost {
  /** Positions dragged on the graph, by note id. Returns false when they can't be saved. */
  move(updates: Record<string, GsPosition>): boolean;
  /** Forget every saved position, so the whole graph is laid out automatically again. Returns false when that can't be saved. */
  resetPositions(): boolean;
  openNote?(path: string, newTab: boolean): void;
  /** The pointer entered a note's node: show its preview (Obsidian's page preview). */
  hoverNote?(event: MouseEvent, el: HTMLElement, path: string): void;
  /** Perform an edit asked for on the graph (Phase 6). Absent: the graph is read-only. */
  edit?(intent: Intent): Promise<EditOutcome>;
  /** A note's text, for the inspector's fields. */
  readNote?(path: string): Promise<string>;
  /** Render a note like Obsidian does into `el`, for the inspector. Returns the cleanup. Absent: the inspector shows the text. */
  renderNote?(el: HTMLElement, path: string): () => void;
  /** Today as `YYYY-MM-DD` (the overdue smell). Defaults to the browser's local date. */
  today?(): string;
}

export interface MountedGraph {
  render(state: GraphState, reveal?: { key: string; nonce: number } | null): void;
  unmount(): void;
}

export interface MountOptions {
  /** Replaces the automatic layout (ELK). The dev page uses it to show a failing layout. */
  autoLayout?: (graph: Graph) => Promise<Record<string, GsPosition>>;
}

/** Mount the graph into an element. The Obsidian view and the dev page both use this. */
export function mountGraph(el: HTMLElement, host: GraphHost, options: MountOptions = {}): MountedGraph {
  const root = createRoot(el);
  const onMove = (updates: Record<string, GsPosition>) => void host.move(updates);
  const onResetPositions = () => void host.resetPositions();
  const onOpenNote = host.openNote?.bind(host);
  const onHoverNote = host.hoverNote?.bind(host);
  const onEdit = host.edit?.bind(host);
  const readNote = host.readNote?.bind(host);
  const renderNote = host.renderNote?.bind(host);
  return {
    render(state, reveal = null) {
      if (!state.graph) {
        root.render(<div className="gs-graph gs-graph-loading">Reading the strategy notes…</div>);
        return;
      }
      root.render(
        <StrictMode>
          <StrategyGraph
            graph={state.graph}
            positions={state.map?.positions ?? EMPTY}
            viewport={state.map?.viewport}
            onMove={state.map ? onMove : null}
            onResetPositions={state.map ? onResetPositions : null}
            onOpenNote={onOpenNote}
            onHoverNote={onHoverNote}
            onEdit={onEdit}
            readNote={readNote}
            renderNote={renderNote}
            today={host.today?.()}
            reveal={reveal}
            notices={state.notices}
            autoLayout={options.autoLayout}
          />
        </StrictMode>
      );
    },
    unmount() {
      root.unmount();
    },
  };
}

const EMPTY: Record<string, GsPosition> = {};
