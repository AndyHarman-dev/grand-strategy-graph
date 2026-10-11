import { Notice, TFile, type App } from 'obsidian';
import { emptyGsMap, GSMAP_PATH, parseGsMap, renameTouches, serializeGsMap, writeOps, type GsOp } from '../core/gsmap';
import { STRATEGY_ROOT } from '../core/memory-adapter';
import { isNodeType } from '../core/schema';
import { GSMAP_EXTENSION, StrategyGraphView, VIEW_TYPE } from './graph-view';

/**
 * "Open strategy graph": focus the tab already showing `Strategy/Strategy.gsmap`, or open it in
 * a new tab, creating an empty one first if the vault has none.
 */
export async function openStrategyGraph(app: App): Promise<StrategyGraphView | null> {
  for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE)) {
    // A background tab restored at startup holds a placeholder until it is loaded (Obsidian 1.7.2+;
    // the manifest allows 1.5, where every view is loaded).
    if (typeof leaf.loadIfDeferred === 'function') await leaf.loadIfDeferred();
    if (leaf.view instanceof StrategyGraphView && leaf.view.file?.path === GSMAP_PATH) {
      await app.workspace.revealLeaf(leaf);
      return leaf.view;
    }
  }
  let file = app.vault.getAbstractFileByPath(GSMAP_PATH);
  if (!file) {
    if (!app.vault.getAbstractFileByPath(STRATEGY_ROOT)) await app.vault.createFolder(STRATEGY_ROOT);
    file = await app.vault.create(GSMAP_PATH, serializeGsMap(emptyGsMap()));
    new Notice(`Created ${GSMAP_PATH}.`);
  }
  if (!(file instanceof TFile)) {
    new Notice(`${GSMAP_PATH} is not a file.`);
    return null;
  }
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  return leaf.view instanceof StrategyGraphView ? leaf.view : null;
}

/** Whether a file is a note that would be a node: markdown with a graph `type`. */
export function isGraphNote(app: App, file: TFile | null): file is TFile {
  return !!file && file.extension === 'md' && isNodeType(app.metadataCache.getFileCache(file)?.frontmatter?.type);
}

/** "Reveal note in graph": open the graph and center on the active note's node. */
export async function revealInStrategyGraph(app: App, file: TFile): Promise<void> {
  const view = await openStrategyGraph(app);
  view?.revealPath(file.path);
}

/**
 * A vault file or folder was renamed: note cards on it follow, in every `.gsmap` that no graph tab has
 * open (an open one follows through its own session, after the edits it still holds). As Obsidian
 * keeps a canvas's file cards, so a rename made while the graph is closed doesn't leave a card behind.
 */
export async function followRenameInMaps(app: App, oldPath: string, newPath: string): Promise<void> {
  const open = new Set(
    app.workspace.getLeavesOfType(VIEW_TYPE).flatMap((leaf) => (leaf.view instanceof StrategyGraphView && leaf.view.file ? [leaf.view.file.path] : []))
  );
  const op: GsOp = { op: 'rename-file', from: oldPath, to: newPath };
  const touched = (text: string) => {
    const read = parseGsMap(text);
    return read.ok && renameTouches(read.map, oldPath);
  };
  for (const file of app.vault.getFiles()) {
    if (file.extension !== GSMAP_EXTENSION || open.has(file.path) || !touched(await app.vault.read(file))) continue;
    // Checked again on the text as it is at write time; a map that can't be read is never written.
    await app.vault.process(file, (text) => (touched(text) ? writeOps(text, [op]) : text));
  }
}

/** Commands run from a callback that Obsidian doesn't await: errors end in a notice, not an unhandled rejection. */
export function reportErrors(what: string, run: () => Promise<unknown>): void {
  run().catch((err) => {
    console.error(`strategy-bet-creator: ${what} failed`, err);
    new Notice(`Strategy graph: ${what} failed — see the developer console.`);
  });
}
