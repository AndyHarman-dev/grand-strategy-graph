import { createContext, useContext } from 'react';

/** What a node can ask of the graph and its host: filled in by `<StrategyGraph>`. */
export interface NodeActions {
  /** The pointer is over a note's node: show its preview (Obsidian's page preview). */
  hover?: (event: MouseEvent, el: HTMLElement, path: string) => void;
  /** Whether edits can be made at all (the host has `edit`): the status pill and the date become controls. */
  canEdit: boolean;
  setStatus: (key: string, status: string) => void;
  /** `YYYY-MM-DD`, or empty to clear. */
  setDate: (key: string, value: string) => void;
}

export const NodeActionsContext = createContext<NodeActions>({ canEdit: false, setStatus: () => {}, setDate: () => {} });

export const useNodeActions = () => useContext(NodeActionsContext);
