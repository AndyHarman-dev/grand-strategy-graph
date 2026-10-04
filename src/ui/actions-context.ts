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

  // ---- free cards and frames (Phase 7); `canEditMap` is false when the `.gsmap` can't be written.
  canEditMap: boolean;
  /** The card or frame (by `card.id` / `frame.id`) whose text is being edited in place, if any. */
  editing: { kind: 'card' | 'frame'; id: string } | null;
  startEdit: (kind: 'card' | 'frame', id: string) => void;
  /** Save the text (the card's text, or the frame's label). Empty text deletes a card. */
  commitText: (kind: 'card' | 'frame', id: string, text: string) => void;
  cancelEdit: () => void;
  /** A resize ended: the new rectangle in graph coordinates. */
  resize: (kind: 'card' | 'frame', id: string, rect: { x: number; y: number; width: number; height: number }) => void;
  openNote?: (path: string, newTab: boolean) => void;
}

export const NodeActionsContext = createContext<NodeActions>({
  canEdit: false,
  setStatus: () => {},
  setDate: () => {},
  canEditMap: false,
  editing: null,
  startEdit: () => {},
  commitText: () => {},
  cancelEdit: () => {},
  resize: () => {},
});

export const useNodeActions = () => useContext(NodeActionsContext);
