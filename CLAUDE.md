# grand-strategy-graph

Obsidian plugin `strategy-bet-creator`: creates Grand Strategy bets and assumptions, and (from Phase 5)
renders the strategy as a data-driven graph. The full plan, decisions (D1–D19) and phase list live in
`docs/plans/2026-09-30-strategy-graph.md`. Read it before starting a phase.

## Hard rules

- **Fixtures only.** The user's real vault never enters this repo or a cloud session. All tests and
  manual runs use the synthetic vault in `test-vault/`.
- **Never commit real-vault outputs**: `migration-report.md`, `resolutions.yaml`, `legacy-edges.json`,
  `migration.diff`, `migration-plan.json`, `migration-applied.json`, `migration-out/` (already in `.gitignore`). If one shows up in
  `git status`, stop and ask. The test-vault versions under `tests/migration/__golden__/` are synthetic and
  are committed on purpose.
- **No Obsidian runtime in the cloud.** Cloud sessions can run npm, Vitest and (from Phase 5a)
  Playwright against the dev page, but not Obsidian. Anything that needs the real app is a manual
  check for the user; say so instead of claiming it works.
- **Core stays pure.** `src/core/` never imports `obsidian`. Anything that needs the app goes in
  `src/obsidian/`.
- **Goldens are the safety net.** `tests/characterization/__golden__/` pins the note bytes the plugin
  writes. Never regenerate them (`npx vitest run -u`) to make a failing test pass. Only update them when
  a phase deliberately changes output (Phase 4), and call out the golden diff in the commit message.
  `tests/migration/__golden__/` pins the migration planner's output over the test vault; same rule.
- **Never run `--apply` in a cloud session.** `tools/migrate.ts --apply` (Phase 3) writes into a vault, so it is
  user-run, local, on the real vault, with Obsidian closed, and only once, at the cutover (Phase 9, D18). Tests apply only to throwaway copies of `test-vault/`
  in the OS temp dir. A legacy edge the classification rules don't cover comes out `unclassified` (exit code 2):
  that is a decision for the user (plan Phase 2, "Escalate/stop"), never something to settle in code. Apply stops
  if any touched file's hash differs from the reviewed dry run; never loosen that guard.
- **The legacy plugin oracle is gone.** Phase 4 intentionally changed the notes the plugin writes (schema v2), so
  `tests/legacy/main.js` and its `legacy` test entries were removed; the goldens now pin the v2 output alone.
  Write-side behavior is tied to `buildGraph` by `tests/characterization/v2-graph.test.ts`: every note the plugin
  creates must build a clean graph. Existing notes change in
  exactly the ways `src/core/writes.ts` lists and no others: a frontmatter field is set, a link is added to or
  removed from a relation field (`processFrontMatter`), a dated line is appended under `## Log`, or the
  assumption's "How I'd Know It's False" section is replaced (`vault.process`, body only, frontmatter untouched).
  Every one comes from an intent in `src/core/edits.ts` (Phase 6); never write a note any other way.

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure TS: helpers, content builders, `actions.ts` (creation intents → planned writes), `edits.ts` + `writes.ts` (edit intents from the graph, and the write kinds both planners produce), schema, graph, smells, `.gsmap` format and position store, ELK layout (`layout.ts`), `graph-session.ts` (everything the graph view does that isn't Obsidian or React) |
| `src/obsidian/` | Obsidian adapter: modals, create flows (execute the planned writes), the graph `FileView` (`graph-view.ts`) and its commands |
| `src/ui/` | React components: `<StrategyGraph>` (React Flow), `mount.tsx` (shared by the plugin and the dev page) |
| `dev/` | Vite dev page (`npm run dev:web`): the graph over the test vault, no Obsidian; `window.gsDev` drives it from Playwright |
| `src/main.ts` | Plugin entry |
| `tools/` | Node-only code: `fs-adapter.ts` (reads a vault folder), `migrate.ts` + `migrate/` (Phase 2 planner, parity gate, report; Phase 3 `apply.ts`) |
| `tests/` | Vitest (`*.test.ts`). `mocks/obsidian.ts` replaces the `obsidian` module; `support/` has the in-memory vault and a fake workspace for the graph view (`fake-workspace.ts`). `e2e/*.spec.ts` is Playwright against the dev page |
| `test-vault/` | Synthetic legacy-format vault; `ANOMALIES.md` maps each note to the anomaly it covers |

## Commands

```sh
npm ci              # install
npm test            # vitest run
npm run typecheck   # tsc --noEmit (TypeScript 7)
npm run build       # esbuild -> dist/main.js (minified) + manifest.json + styles.css (React Flow's CSS inlined)
npm run dev         # esbuild watch (unminified, inline source map)
npm run dev:web     # Vite dev page at http://localhost:5173 (?vault=legacy, ?theme=dark)
npm run test:e2e    # Playwright against the dev page (starts it); --grep-invert @visual skips screenshots
npm run migrate -- --vault <path> [--resolutions <file>] [--out <dir>]   # migration dry run (outputs outside the vault)
npm run migrate -- --vault <path> --resolutions <file> --apply            # user-run, at the cutover only (backs up to ~/strategy-backups)
```

Run `npm run typecheck && npm test && npm run build` before every push, and `npm run test:e2e` when `src/ui/`,
`src/core/layout.ts`, the graph view or `dev/` changed.

## Test vault

- `test-vault/.obsidian/plugins/strategy-bet-creator` is a committed symlink to `../../../dist`, so
  opening `test-vault/` in Obsidian runs the latest build.
- Every note there exists to exercise an anomaly. Update `test-vault/ANOMALIES.md` whenever a note
  changes, and don't "fix" anomalies: they are the test data.
- Tests read it through `tests/support/fake-app.ts` (`readTestVault()`), never by writing to it.

## Releases (BRAT)

The real vault only runs tagged releases, and gets none before the cutover (Phase 9, D18): the plugin writes
schema v2, which must not land in an unmigrated vault. To release: bump `version` in both `manifest.json` and
`package.json`, commit, then push a tag equal to that version (no `v` prefix). `release.yml` checks the
versions match, runs the checks, and attaches `main.js`, `manifest.json` and `styles.css` to a GitHub
Release.

## Graph view (Phase 5a)

- `Strategy/Strategy.gsmap` opens as the graph tab (`registerExtensions`). The graph is always re-derived from frontmatter
  via `metadataCache`; the `.gsmap` holds positions (by note `id`), viewport, and the Phase 7 cards/frames/links.
- Positions are written only after a drag ends (400 ms quiet, flushed on tab close), through `vault.process`, and only
  the moved ids change (`writePositions`). A `.gsmap` that doesn't parse, or has a newer `version`, is never written.
- Auto-placed (ELK) positions are not saved on their own, but every drag (or arrow-key nudge) also saves every shown node
  that has no saved position yet (`unsavedPositions`), so nothing but the moved nodes ever moves. Fixed points and notes
  without a unique `id` can't be dragged (fixed points are still pinned that way).
- Selection works as on an Obsidian canvas: drag on empty space draws a selection box (partial overlap selects),
  Shift/Cmd/Ctrl-click toggles, Cmd/Ctrl+A selects all, Escape clears; a two-finger trackpad swipe (scroll) pans 1:1
  (`panOnScrollSpeed={1}`), as do Space+drag and middle-drag; pinch or Cmd/Ctrl+scroll zooms. Dragging any selected node moves the selection; arrow keys nudge it and are saved.
- The reset button (circular arrow in the controls) empties `positions` after a confirmation (`clearPositions`, through the
  same write queue as moves), and the view fits the new automatic layout.
- Free cards, frames and `.gsmap` links (Phase 7) are drawn from the map and edited through `GsOp`s (`gsmap.ts`: `put-card`,
  `delete-card`, …, `promote-card`), which the store shows at once and writes with the position moves in one `vault.process`.
  `writeOps` changes only the touched items; unknown keys survive. Their React Flow ids are `card:<id>` / `frame:<id>` /
  `link:<id>`, so they can never clash with a note key. Frames are backdrops (`pointer-events: none` except the label): a click
  on the label selects one, and a selection box selects one only when it holds the whole frame, as on an Obsidian canvas
  (`framesInBox`; Cmd/Ctrl+A still leaves them out). Right-clicking a selection of several nodes (or the selection's box)
  offers "Create frame around selection", as a canvas's "Create group" (`frameAround`, `FRAME_PADDING`); a bigger frame is
  always drawn behind a smaller one. Dragging a frame (by its label) carries every node wholly inside it at the start, as an
  Obsidian canvas group does (`frameContents`); frames stay visual only, nothing is written to notes. A card on either end of
  a dragged link makes a free link; two notes make a relation. Promoting a card creates the note first (an edit intent), then
  runs `promote-card` (links and place move to the note). Any vault note can be put on the graph as a note card: drop it from
  the file explorer (`GraphHost.droppedNotes`, reading Obsidian's `dragManager`) or right-click → "Add note card…" (`pickNote`). A note card names its file by path, so it follows a rename or move (of
  the file or a folder above it, `rename-file` op): through the session when a graph tab has the map open, else
  `followRenameInMaps` (plugin-wide) writes the `.gsmap` itself.
- Rebuilt React Flow nodes must keep `measured`: without it React Flow drops the node's measured handles and draws none of
  its edges until it re-measures (the "all edges vanish while dragging" bug).
- Layout rule (plan D19): left → right is time; assumptions are never on the time axis but above their host (below if
  no room, aside if a sequel is below); a `next` sequel sits under its bet; a dragged bet takes its hosted assumptions.
  A drag also pushes what the dragged note `requires` (the whole chain) to the left, horizontally only and only when the
  note would come closer than the gap they had (`PREREQUISITE_GAP` at most); `dragCompanions` decides all of it.
- `requires` implies `serves` (bug 8): adding "H requires X" also writes "X serves H" where the relation table allows it
  (`requiresImpliesServes`); the migration writes the same. A bet, milestone or fixed point may `require`. The `serves` twin of
  a `requires` is not drawn a second time, and a note with two or more `requires` gets an automatic "AND" junction
  (`junctionsOf`, React Flow id `and:<key>`): never stored, not editable, placed just left of its holder and moving with it only.
  The migration no longer keeps canvas "AND" cards whose `requires` are in the notes.
- Playwright screenshot baselines (`tests/e2e/graph.spec.ts-snapshots/`, tagged `@visual`) are like goldens: update
  them (`npx playwright test -g @visual --update-snapshots`) only for a deliberate visual change, and say so in the
  commit. They are Linux/Chromium baselines from cloud sessions; CI runs `--grep-invert @visual`.

## Gotchas

- `obsidian.d.ts` types `moment` as a non-callable namespace under TS 7; use `today()` from
  `src/obsidian/today.ts` instead of calling `moment` directly.
- The esbuild options live in `esbuild.options.mjs` and are shared with
  `tests/characterization/bundle.test.ts`, which builds and loads the real bundle. Change them there.
- `@playwright/test` is pinned to 1.56.1: its Chromium (build 1194) is the one preinstalled in cloud sessions
  (`/opt/pw-browsers`). Bumping it means `npx playwright install chromium`, which cloud sessions can't rely on.
- The obsidian mock (`tests/mocks/obsidian.ts`) has `Events`/`Component`/`FileView` that release registered events on
  `unload()`, as Obsidian does; the view tests check no handler survives a closed tab.
