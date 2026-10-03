import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { GraphState } from '../core/graph-session';
import type { GsPosition } from '../core/gsmap';
import type { Graph } from '../core/schema';
import { StrategyGraph } from './StrategyGraph';

export interface GraphHost {
  /** Positions dragged on the graph, by note id. Returns false when they can't be saved. */
  move(updates: Record<string, GsPosition>): boolean;
  /** Forget every saved position, so the whole graph is laid out automatically again. Returns false when that can't be saved. */
  resetPositions(): boolean;
  openNote?(path: string, newTab: boolean): void;
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
