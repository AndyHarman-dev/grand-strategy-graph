import { createContext, useContext } from 'react';

/** What a node can ask of the host without the graph knowing Obsidian: filled in by `<StrategyGraph>`. */
export interface NodeActions {
  /** The pointer is over a note's node: show its preview (Obsidian's page preview). */
  hover?: (event: MouseEvent, el: HTMLElement, path: string) => void;
}

export const NodeActionsContext = createContext<NodeActions>({});

export const useNodeActions = () => useContext(NodeActionsContext);
