/**
 * The dev page: a GraphSession over a MemoryAdapter, mounted with the same `mountGraph` the
 * plugin uses. The `.gsmap` lives in memory (reload to reset). `window.gsDev` lets Playwright
 * read and change the in-memory vault.
 */
import vaults from 'virtual:test-vault';
import '../src/styles.css';
import './obsidian-theme.css';
import type { Intent } from '../src/core/edits';
import { GraphSession, type GraphState } from '../src/core/graph-session';
import { GSMAP_PATH, parseGsMap, serializeGsMap } from '../src/core/gsmap';
import { MemoryAdapter } from '../src/core/memory-adapter';
import { MemoryVault } from '../src/core/memory-vault';
import { performIntent } from '../src/core/perform';
import { localToday } from '../src/ui/model';
import { mountGraph } from '../src/ui/mount';

const params = new URLSearchParams(location.search);
const vaultName = params.get('vault') === 'legacy' ? 'legacy' : 'planned';
const files: Record<string, string> = { ...vaults[vaultName] };
// ?layout=auto drops the saved positions, to see the automatic layout (D19) on the whole vault.
let gsmapText = params.get('layout') === 'auto' ? withoutPositions(files[GSMAP_PATH] ?? '') : files[GSMAP_PATH] ?? '';
// ?gsmap=broken: a file this version can't read, to see what the graph offers then.
if (params.get('gsmap') === 'broken') gsmapText = '{ not a gsmap';
files[GSMAP_PATH] = gsmapText;
const vault = new MemoryVault(files);
let writes = 0;
let state: GraphState | null = null;
let reveal: { key: string; nonce: number } | null = null;
const opened: string[] = [];
const hovered: string[] = [];

const status = document.getElementById('status')!;
const mounted = mountGraph(document.getElementById('content')!, {
  move: (updates) => session.move(updates),
  resetPositions: () => session.resetPositions(),
  editMap: (op) => session.editMap(op),
  openNote: (path) => {
    opened.push(path);
    status.textContent = `open ${path}`;
  },
  hoverNote: (_event, _el, path) => hovered.push(path),
  // ?today=YYYY-MM-DD pins the clock, so the overdue smell (and the screenshots) don't depend on the day.
  today: () => params.get('today') ?? localToday(),
  // Edits go to the in-memory notes, as Obsidian's would to the vault, then the graph is read again.
  // ?readonly=1: a host without `edit`, to see the graph as it is when nothing can be written.
  ...(params.get('readonly') === '1'
    ? {}
    : {
        edit: async (intent: Intent) => {
          if (!state?.graph) return { ok: false, message: 'The graph has not been read yet.' };
          const outcome = await performIntent(intent, { graph: state.graph, vault, today: params.get('today') ?? localToday() }, vault);
          await session.rebuild();
          return outcome;
        },
      }),
  readNote: async (path) => {
    if (!(path in files)) throw new Error('Not a note: ' + path);
    return files[path];
  },
}, params.get('elk') === 'fail' ? { autoLayout: () => Promise.reject(new Error('simulated ELK failure')) } : {});

const session = new GraphSession({
  adapter: { readNotes: () => new MemoryAdapter(files).readNotes() },
  write: async (edit) => {
    gsmapText = edit(gsmapText);
    files[GSMAP_PATH] = gsmapText;
    writes++;
    session.loadMap(gsmapText); // what a modify event does in Obsidian
    return gsmapText;
  },
  onUpdate: (next) => {
    state = next;
    mounted.render(next, reveal);
  },
  onIdChange: (message) => (status.textContent = message),
  saveDelayMs: Number(params.get('saveDelay') ?? 400),
  rebuildDelayMs: 100,
});
session.loadMap(gsmapText);
void session.rebuild();

const select = document.getElementById('vault') as HTMLSelectElement;
select.value = vaultName;
select.onchange = () => {
  params.set('vault', select.value);
  location.search = params.toString();
};
const auto = document.getElementById('auto') as HTMLInputElement;
auto.checked = params.get('layout') === 'auto';
auto.onchange = () => {
  if (auto.checked) params.set('layout', 'auto');
  else params.delete('layout');
  location.search = params.toString();
};
const dark = document.getElementById('dark') as HTMLInputElement;
dark.checked = params.get('theme') === 'dark';
document.body.classList.toggle('theme-dark', dark.checked);
dark.onchange = () => document.body.classList.toggle('theme-dark', dark.checked);

declare global {
  interface Window {
    gsDev: typeof api;
  }
}

const api = {
  /** The `.gsmap` as last written. */
  gsmap: () => gsmapText,
  writes: () => writes,
  file: (path: string) => files[path],
  /** Change a note (or add one) and let the session rebuild, as a metadataCache change would. */
  setFile(path: string, text: string | null) {
    if (text === null) delete files[path];
    else files[path] = text;
    session.requestRebuild();
  },
  rename(oldPath: string, newPath: string) {
    files[newPath] = files[oldPath];
    delete files[oldPath];
    session.rename(oldPath, newPath);
  },
  reveal(key: string) {
    reveal = { key, nonce: (reveal?.nonce ?? 0) + 1 };
    if (state) mounted.render(state, reveal);
  },
  notices: () => state?.notices ?? [],
  opened: () => opened,
  hovered: () => hovered,
  flush: () => session.flush(),
};
window.gsDev = api;

function withoutPositions(text: string): string {
  const read = parseGsMap(text);
  return read.ok ? serializeGsMap({ ...read.map, positions: {} }) : text;
}
