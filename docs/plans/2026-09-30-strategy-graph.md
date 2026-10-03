---
status: In Progress
---

# Strategy Graph — data-driven, Obsidian-native graph for the Grand Strategy

## Context

**Goal:** replace the hand-maintained `Strategy/The Map.canvas` with a graph view inside
Obsidian, opened as its own tab and built entirely from note data. The only state the user
edits by hand is node positions. Bets, assumptions and links can be created and edited
directly from the graph.

**Inputs:** `gs_framework.md`, `canvas_rules.md`, the existing `strategy-bet-creator`
plugin (plain JS, 883 lines, no build step), and a read-only survey of the real vault at
`~/Obsidian/Main Vault/Strategy` (24 bets, 25 assumptions, 3 fixed points, empty
`Milestones/`, one canvas with 54 file nodes, 10 text cards, 9 groups and 73 edges).

### Decisions locked (2026-09-30)

| # | Decision |
|---|---|
| D1 | One merged plugin (bet creator + graph), rewritten in TypeScript + React, built with esbuild. |
| D2 | All relationships live in **frontmatter**. Duplicate relationship sections in note bodies are removed. "Depended on by" is computed from frontmatter, never written. |
| D3 | Node positions, viewport, free cards and frames live in a **vault file** `Strategy/Strategy.gsmap` (JSON), opened as the graph tab. |
| D4 | Milestones and the current position are **real notes** with a `type`. (Routes and ghosts were in the original D4; see D16.) |
| D5 | Serves is split in two: `serves` (direct parent) and `ultimately-serves` (the far fixed point). |
| D6 | Statuses are **normalized to canvas_rules**: `asleep → dormant`, `cancelled → killed`. |
| D7 | New bet→bet relation `requires` (prerequisites; the canvas "AND" diamond becomes several `requires` links). Assumptions can attach to any node type, including fixed points. A bet may also require a milestone (D17). |
| D8 | Canvas migration: copy positions into `.gsmap`, migrate canvas text cards and groups, and support **free cards**. Free cards exist only on the graph (stored in `.gsmap`) and can be promoted to a real note. |
| D9 | Development happens in a GitHub repo using Claude on GitHub / Claude Code on the web. **The real vault never goes into the repo**; cloud work runs against synthetic fixtures only. |
| D10 | The repo lives at `~/dev/grand-strategy-graph`, remote `https://github.com/AndyHarman-dev/grand-strategy-graph.git`, branch `main`. No feature branch (user instruction, 2026-09-30). esbuild writes to `dist/` (gitignored). The real vault's plugin folder is **not** the repo: it gets tagged releases only, via BRAT. |
| D11 | A synthetic **test vault** lives at `test-vault/` in the repo. It is legacy format and covers every anomaly class (see `test-vault/ANOMALIES.md`). Its plugin folder `test-vault/.obsidian/plugins/strategy-bet-creator` is a committed **symlink to `../../../dist`**, so it always runs the latest build. The symlink targets `dist/`, not the repo root, which would create a loop. The test vault is both the test fixture and the vault to open in Obsidian for manual testing. |
| D12 | The body `## Serves` list is **dropped** without being merged (user: "it's just the same as the frontmatter"). Body-only links still appear in the migration report as *dropped*, so the parity gate accounts for them. `ultimately-serves` stays in the schema as an optional field, set by hand or from the graph; the migration doesn't fill it. |
| D13 | Assumption status `undeterminable` is kept (styled gray). Links to the phantom `FP-2 Multi-billion dollar AI company` are **left as they are**: no retargeting, only listed in the report. |
| D14 | Canvas edges that touch a **group** (note→group, group→note, an "On Kill" to a group included) are **dropped** and listed in the report. The group itself still becomes a frame. (User, 2026-10-02, after the real-vault dry run found four.) |
| D15 | `type: strategic-inbox` is a known **non-graph** type: such notes are left untouched by the migration and skipped by `buildGraph` without an issue. Other unknown types are still reported. (User, 2026-10-02.) |
| D16 | **Routes are not a node type.** The "route" boxes on the old canvas were placeholders for starting something, with no strategic value of their own. What a route means in the strategy is a chain of `serves` links from bets up to a fixed point (B-1 serves B-2 serves FP-1). That chain is derived from the relations and never stored. So: no `route` type, no ghost routes, no `R-<n>` ids, no route commands. The canvas route labels migrate as free cards (D8) like any other text card, and stay free cards. (User, 2026-10-03.) |
| D17 | **Milestones are checkpoints** on the way to a fixed point: the place to begin from when paving further bets. A milestone `serves` a fixed point or another milestone. Bets that work toward it `serve` it. Bets that start from it list it in `requires`, which may now point at a bet or a milestone. So the chain reads: bets → milestone → further bets → fixed point. A milestone has `status: open | reached`; flipping it to `reached` is the moment those bets can start, and an active bet that requires a milestone still `open` is a smell. (User, 2026-10-03; the attached meta-framework has no milestone concept, so this is the user's own definition.) |

### Schema v2 (target)

```yaml
# Every strategy note
id: B-10                  # stable key used for positions; never derived from the filename again
type: bet | assumption | fixed-point | milestone | current-position
status: ...               # per type, below

# bet
status: active | dormant | won | killed | extended
started, deadline, expected-result      # unchanged
serves: ["[[B-11 …]]"]                  # direct parents (bet | milestone | fixed-point)
ultimately-serves: ["[[FP-3 …]]"]       # far anchor(s); fixed points only
requires: ["[[B-1 …]]"]                 # prerequisites: bets, or milestones that must be reached first (D17)
next: "[[B-16 …]]"                      # sequel activated on kill (renamed from `next sequel`)
assumptions: ["[[A-1 …]]"]              # also allowed on fixed-point / milestone

# assumption
status: unverified | confirmed | falsified | undeterminable   # undeterminable kept (D13)
created, verify-by                       # unchanged; existing datetime values are left as they are

# milestone
status: open | reached                   # reached = the checkpoint the bets that require it start from
serves: ["[[FP-1 …]]"]                  # fixed point | another milestone
assumptions: ["[[A-1 …]]"]
```

A "route" is not a type (D16): it is any chain of `serves` links leading to a fixed point.

Edges are drawn per canvas_rules. Bet→serves: solid. Unverified serve: dashed.
`next`: dashed with an "on kill" label. Assumption leader: thin dashed with no arrowhead.
`requires`: a distinct dotted style. `ultimately-serves`: hidden by default; shown when
toggled, or when a bet has no `serves` chain reaching a fixed point.

### Survey findings that shape the migration (from the real vault)

- **Serves disagrees** between frontmatter and body in 12/24 bets. The usual pattern is that frontmatter names the immediate parent and the body names the fixed point (that's why D5).
- **Bet→assumption links exist only in the body.** The reverse lists (`## Depended On By`) are **asymmetric**:
  - A-10 lists B-5 and B-6, but neither bet lists A-10.
  - A-11, A-12, A-14 and A-15 have empty reverse lists although their bets point at them.
  - A-7 is depended on by **FP-1**.
- **Bets listed as assumptions:** B-4 lists B-3, B-1, B-5. B-6 lists B-3. These become `requires` (D7).
- **Malformed or dangling links:**
  - `[[...]]` in B-18 and B-19 serves
  - `[[A-]]` and `[[FP-]]` in B-5
  - B-1 serves **itself**
  - B-1 links `[[A-19 Testing new assumption]]`, which doesn't exist (the real A-19 is a different note)
- **Phantom note:** `[[FP-2 Multi-billion dollar AI company]]` (B-2, B-3, B-4, B-8, B-9) resolves to an **empty stray file at the vault root**, not to the real `FP-2 Successful multi-billion dollar entrepreneur`. Per global rules it is reported, never deleted.
- **Statuses in use:**
  - bets: `active`, `asleep`, `won`, `cancelled`
  - assumptions: `unverified`, `confirmed`, `falsified`, `undeterminable`
- **Field name:** `next sequel` (with a space) vs `next` in canvas_rules.
- **Basename quirk:** `B-10  byTalent backend engineer` (double space) is why `id:` must be explicit.
- **Other frontmatter to keep:** B-16 has `categories:`, which must survive. `Current Position.md` has no `type`.
- **Dataview queries** in the review templates only filter on `status = "active"`, so D6 doesn't break them. Past review notes are static.
- **Templates:** `Templates/Bet Template.md` and `Templates/Assumption Template.md` still emit the legacy shape (Templater/QuickAdd are installed). They must be migrated too, or legacy notes keep reappearing.
- **Canvas-only data:**
  - 9 groups (Enterprenurship, Employment, Study → H1B path, Citizenship, …)
  - 10 text cards (route labels, "O1 visa path?", "Route C — DV Visa…" with a dashed border, "AND" diamond, "Needs elaboration", "What's the sequel for US study path?")
  - labelled edges ("On kill", "Killed", "indirectly serves", "Only A-21", "Non significant relationship")
  - one non-strategy note on the canvas: `argentine-citizenship-affects-us-path.md`
- **No git** anywhere: neither the vault nor `~/strategy-bet-creator`. The installed plugin copy is byte-identical to `~/strategy-bet-creator`.

### Open items

None. O1→D13, O2→D12, O3→D13 (resolved 2026-09-30).

---

## Phase 0 — Repo bootstrap and TS port with byte parity

**Model: Sonnet 5.** This is mechanical porting. The golden-output tests below fail loudly on any drift in the generated notes.

- **Current State.** The repo is cloned at `~/dev/grand-strategy-graph` (D10). `main` holds the remote's `LICENSE` commit. The three plugin files (main.js, manifest.json, styles.css), this plan, `.gitignore` and `test-vault/` sit uncommitted. `dist/` holds a manual copy of the three plugin files so the test vault works before a build exists. There is no build and there are no tests.
- **Desired State.**
  - A private GitHub repo with a TS + esbuild + React toolchain.
  - The plugin is ported to TS with **identical behavior**.
  - Vitest is set up, and the synthetic test vault (`test-vault/`) is wired into the tests.
  - A CI workflow builds `main.js`, `manifest.json` and `styles.css` and attaches them to a GitHub Release, so the plugin installs through **BRAT**.
  - A repo `CLAUDE.md` tells cloud sessions the rules: fixtures only, no Obsidian runtime in the cloud.
- **Problems.**
  - There is no safety net, so any refactor is unverifiable.
  - The pure helpers (`parseIds`, `sanitizeTitle`, `insertIntoSection`, `buildBetContent`, …) are already side-effect free but untested.
- **Solutions.**
  1. Commit the current state as the **baseline commit** on `main` (legacy plugin files at the root, plan, test vault). Then move the source to `src/`, and have esbuild write `main.js`, `manifest.json` and `styles.css` into `dist/`. `.gitignore` (already in place) covers `node_modules/`, `dist/`, `data.json`, the test vault's per-machine `.obsidian` state, and the real-vault migration outputs.
  2. Before porting, write **characterization tests against the current `main.js`**: golden outputs of `buildBetContent`, `buildAssumptionContent` and `buildWritePlan` (with a mocked app) over representative inputs. Port to `src/` in TS, and the same tests must stay green.
  3. Layout:
     - `src/core/`: pure code with no `obsidian` imports
     - `src/obsidian/`: adapter, views, commands
     - `src/ui/`: React components
     - `tools/`: Node CLIs
     - `test-vault/`: synthetic legacy-format vault (already seeded; `test-vault/ANOMALIES.md` maps each note to the anomaly it exercises)
  4. `test-vault/` already has **one synthetic note per anomaly class** from the survey: scalar serves, `[[...]]`, self-loop, dangling link, phantom target, asymmetric reverse list, bet listed as an assumption, assumption on a fixed point, double-space basename, extra frontmatter keys, datetime `verify-by`, and a canvas with groups, text cards and labelled edges. No real content.
  5. Add `.github/workflows/release.yml` (tag → build → release assets) and `ci.yml` (typecheck + vitest on PRs).
- **Verify:** `npm test` is green, and the built plugin in the real vault creates a bet whose file is byte-identical to one made by the old plugin with the same input (manual check by the user).

## Phase 1 — Schema v2 + pure graph core

**Model: Sonnet 5.** The schema is fully locked above (D2–D7). This phase transcribes it into types, a parser and checks, each covered by fixture tests.

- **Current State.** No graph model exists. Relationships are scattered across frontmatter, body sections and the canvas.
- **Desired State.** `src/core/graph.ts`: `buildGraph(notes: NoteRecord[]) → { nodes, edges, issues }`. Here `NoteRecord = { path, basename, frontmatter, resolvedLinks }` comes from a `VaultAdapter`. `src/core/smells.ts` flags:
  - orphan bets (no `serves` chain to any fixed point)
  - fixed points with nothing reaching them
  - **gating violations**: an active bet with an unverified assumption that has no `verify-by`
  - an active bet whose assumption is falsified
  - a deadline that has passed on an active bet
  - a dormant bet that isn't anyone's `next`
- **Problems.** Link resolution must match Obsidian's rules, not the filename prefix. Edge kinds come from the field name **and** the target's `type`.
- **Solutions.**
  - Types live in `src/core/schema.ts`.
  - The `VaultAdapter` interface has three implementations:
    - `ObsidianAdapter`, which uses `metadataCache.getFirstLinkpathDest` and `frontmatterLinks`
    - `FsAdapter` (Node, for the CLIs and tests)
    - `MemoryAdapter` (dev page)
  - Unknown statuses or types become `issues`; they don't throw.
  - Unit tests cover every smell over the test vault (`test-vault/`).

## Phase 2 — Migration planner + parity oracle (dry-run only)

**Model: Opus 5.** This is the one phase where a wrong result still looks right: a dropped or misclassified edge produces a perfectly valid note. It turns four inconsistent sources into one truth over the user's only copy of their strategy data.
**Escalate/stop if:** the oracle shows any legacy edge the classification rules below don't cover. That is a new decision for the user, not something to pick in code.

- **Current State.** Legacy notes as surveyed above.
- **Desired State.** `tools/migrate.ts --vault <path> [--resolutions file] [--apply]`. **The default is a dry run** that writes nothing to the vault and produces three outputs:
  1. `migration-report.md`: every legacy edge and its fate
  2. a `resolutions.yaml` skeleton listing every ambiguity for the user to fill in
  3. the planned new content of every touched file, as diffs
- **Problems.** Data is spread over five sources, they disagree, and some data exists in only one of them.
- **Solutions.**
  1. **Oracle (capture before anything changes).** Collect *every* legacy edge from:
     - (a) frontmatter `serves`/`next sequel`
     - (b) body `## Serves`
     - (c) body `## Assumptions This Bet Depends On`
     - (d) assumption `## Depended On By`
     - (e) `The Map.canvas` file↔file edges

     Save it as `legacy-edges.json` (source, from, to, label). This is the **parity oracle** (global rule: capture the old behavior before deleting it).
  2. **Classification rules** (by target `type`, never by name prefix):

     | Source | Target type | Becomes |
     |---|---|---|
     | fm `serves` | any | `serves` |
     | body serves (any) | — | section dropped; body-only links listed as *dropped* in the report (D12) |
     | body/reverse assumption link | assumption | `assumptions` on the dependent |
     | body assumption link | bet | `requires` |
     | reverse list | fixed-point dependent | `assumptions` on the fixed point (A-7 → FP-1) |
     | `next sequel` | — | `next` |
     | canvas edge "On kill" | — | `next`, if not already present |
     | canvas edge, other label | — | report (candidate relation) |
     | malformed / self-loop / dangling | — | report + resolutions; **never written** |
     | link to phantom FP-2 | — | kept as is, listed in the report (D13) |

     The forward and reverse assumption lists are **unioned**, so asymmetric entries are kept.
  3. **Rewrites:**
     - Add `id` (parsed from the basename, with collisions checked as `parseIds` does today).
     - Normalize scalar `serves` to a list.
     - Statuses: `asleep → dormant`, `cancelled → killed`, `undeterminable` kept.
     - Rename `next sequel → next`.
     - Add `type: current-position` to `Current Position.md`.
  4. **Body edits (only these three sections):**
     - Remove `## Serves` and `## Assumptions This Bet Depends On` from bets.
     - In assumptions, replace `## Depended On By` with a live Dataview block listing dependents. It is computed, so it never needs syncing.
     - **Every other byte of the body stays the same.**
  5. **Unknown frontmatter keys** (e.g. `categories`) and key order are preserved. Use the `yaml` package's Document API to edit, not re-serialize from scratch.
  6. **Canvas → `.gsmap`.**
     - Each canvas file node's x/y goes to `positions[id]`.
     - Text cards become **free cards** with their text, color and style. The diamond is kept as a card, plus `requires` links per the resolutions file.
     - Groups become **frames** (label, rect, color).
     - Labelled edges between cards and notes become free card links.
     - The non-strategy note node (`argentine-citizenship-affects-us-path.md`) becomes a **note-reference card**.
- **Parity gate (named step, must pass before Phase 3).** Run the planner on the test vault (`test-vault/`) and on a **copy** of the real vault. Then run `buildGraph` (Phase 1) over the *planned* output and check:
  - every oracle edge is either present as its classified relation or listed in the report as dropped with a reason
  - **zero unaccounted edges**
  - the prose diff outside the three sections is empty
  - every canvas file node has a position

  The user reviews `migration-report.md` and fills in `resolutions.yaml`. The planner is re-run until the report has no open ambiguities.

## Phase 3 — Apply migration to the real vault (user-run, local)

**Model: Sonnet 5.** The planner did the thinking. Apply only writes planned content, and a full backup outside the vault makes it reversible.
**Escalate/stop if:** apply sees any file whose content hash differs from the dry-run plan, which means the vault changed in between.

- **Current State.** Reviewed dry-run, filled-in resolutions.
- **Desired State.** The real vault is in schema v2, `Strategy/Strategy.gsmap` exists, and `The Map.canvas` is untouched.
- **Solutions.**
  1. Close Obsidian, or pause Sync.
  2. `--apply` first copies `Strategy/`, `Templates/`, `The Map.canvas` and the phantom root file to `~/strategy-backups/<timestamp>/`. **This is outside the vault on purpose:** a copy inside the vault would duplicate basenames and break link resolution.
  3. Apply writes are hash-guarded against the dry-run.
  4. Update `Templates/Bet Template.md` and `Templates/Assumption Template.md` to schema v2.
  5. Re-run the parity check on the live result.
- **Verify:** the user opens a few migrated notes in Obsidian. The Properties panel shows the relations, and the Dataview "dependents" block renders.

## Phase 4 — Creation flows write schema v2

**Model: Sonnet 5.** Small, contained changes to the ported modals. Phase 0's golden tests are updated deliberately, and the diff makes every change visible.

- **Current State.** The modals write the legacy shape and `insertIntoSection` back-links into other notes (`app.vault.process`).
- **Desired State.**
  - Modals write v2 frontmatter, including `id`, `assumptions` and `next`.
  - There are **no cross-note body writes**, and `insertIntoSection` is deleted.
  - Creating an assumption for existing bets appends to *the bet's* `assumptions` via `processFrontMatter`.
  - Modals gain optional fields `requires`, `next` and `ultimately-serves`.
  - New command: "New milestone" (`status: open`). The bet form's `requires` picker offers bets and milestones.
- **Solutions.** All creation goes through `src/core/actions.ts`, a set of pure "intent → planned writes" functions, executed by the adapter. The graph's quick actions in Phase 6 reuse exactly these.

## Phase 5a — Graph view integration (React Flow in Obsidian)

**Model: Opus 5.** This is the first integration with no precedent in the repo. Correctness spans `FileView` lifecycle, React mount/unmount, `metadataCache` change/rename/delete events, and `.gsmap` save debouncing all at once. The bugs here (stale graph after rename, lost positions, leaks on tab close) don't fail any unit test.

- **Desired State.**
  - `registerExtensions(['gsmap'], VIEW_TYPE)`. Opening `Strategy.gsmap` shows the graph in a normal tab.
  - The view re-derives the graph from `metadataCache` on every change, debounced.
  - Positions save to `.gsmap` on drag-end only.
  - Renames need no handling because positions are keyed by `id`. A note whose `id` changes is reported.
  - Nodes with no position are placed by **ELK** (layered, left→right: current position → bets → milestones → fixed points, with bets layered along their `serves` chains). Pinned positions are kept.
  - Fixed points are locked (not draggable).
  - Commands: "Open strategy graph" and "Reveal note in graph".
- **Solutions.**
  - React Flow (`@xyflow/react`) + `elkjs`.
  - `.gsmap` writes go through `vault.process` with a schema version field.
  - On close: unmount the React root and unregister events.
- **Dev harness (cloud-friendly).** `npm run dev:web` runs a Vite page that renders the same `<StrategyGraph>` from `MemoryAdapter`, loaded with the test vault (`test-vault/`). Playwright screenshot tests run there.
- **Playwright:** not installed globally on the user's machine. It is added as a dev dependency in the repo. **Suggest the user does visual verification with it** after 5a/5b/6.

## Phase 5b — Node and edge styling per canvas_rules

**Model: Sonnet 5.** A direct mapping table from canvas_rules to components. Playwright screenshots of the fixture graph catch regressions.

- Node components per type and status:
  - fixed point: distinct shape, locked
  - milestone: checkpoint shape, open vs reached
  - active / dormant / won / killed bets
  - assumption amber / green / red / gray
  - current position: leftmost and neutral
- Edge styles as in the Schema section.
- Theme via Obsidian CSS variables.
- Node shows: id, title, status pill, deadline or verify-by, and a smell badge.
- Hover shows the note preview.

## Phase 6 — Editing from the graph

**Model: Sonnet 5.** Every edit is a Phase 4 action (an intent → frontmatter patch), unit-tested in core. The UI only dispatches intents.

- **Inline on the node:** status pill dropdown, deadline or verify-by date picker.
- **Inspector side panel** (on select):
  - form for X/Y/Z, expected result and falsifier
  - relation lists with add/remove and link pickers
  - "+ log entry", which appends a dated line under `## Log`
  - rendered note body (`MarkdownRenderer`)
  - "Open in split"
- **Edge drawing:** drag from a handle to a node. The relation is inferred from the source and target types; if it's ambiguous, a small menu asks (serves / requires / next / assumption). Deleting an edge removes the link.
- **Context menu:**
  - New sequel bet (pre-fills `next` on the source)
  - Add assumption
  - New bet serving this
  - **Kill → activate next**: one atomic action that sets the bet to `killed`, the `next` bet to `active`, and writes log lines in both notes
  - Mark assumption falsified (dependents get flagged)

## Phase 7 — Free cards, frames, promote-to-note

**Model: Sonnet 5.** Additive UI over `.gsmap` data that Phase 2 already defines. Fixture-tested.

- **Free cards:** create, edit and delete on the graph (stored only in `.gsmap`), with optional links between cards and to notes. The edge style can be set freely, since free cards carry no strategy semantics.
- **Frames:** resizable labelled regions, the old canvas groups. Purely visual.
- **"Promote to note":** a free card becomes a real note (bet, assumption or milestone) via the Phase 4 actions. The card's position transfers to the new note's `id`.
- Migrated canvas cards arrive here and can be promoted one by one. The old route labels stay free cards (D16).

## Phase 8 — Smell overlay + review walk

**Model: Sonnet 5.** Renders Phase 1 smells that are already tested.

- A badge on each node, plus a "Smells" panel listing orphans, unreached fixed points, gating violations, falsified dependencies and overdue bets. Clicking an item focuses the node.
- **New smell (D17):** an active bet that requires a milestone still `open`. Added to `src/core/smells.ts` with tests first, then rendered here.
- **Review walk:** steps through each fixed point, then outward along the `serves` chains that lead to it (those chains are the strategy's routes, D16), in a fixed order (replaces canvas presentation mode).

## Phase 9 — Retire `The Map.canvas`

**Model: Sonnet 5.** No code. This is a gate plus one user action.

- **Parity gate:** re-run the Phase 2 oracle against `The Map.canvas` and the live graph. Every canvas edge must be present as a relation or free-card link, or explicitly dropped in the report. Every canvas node must have a position, card or frame.
- Then the **user** moves the canvas into an archive folder. It is never deleted by tooling.

**Routing:** Phases 0, 1, 3, 4, 5b, 6, 7, 8, 9 → Sonnet 5 · Phases 2, 5a → Opus 5

---

## Development setup (GitHub + Claude)

- **Repo:** `https://github.com/AndyHarman-dev/grand-strategy-graph.git`, cloned at `~/dev/grand-strategy-graph` (D10).
- **Where work happens:**
  - Claude Code on the web (claude.ai/code) for the phase sessions
  - `claude-code-action` for PR review / @claude on issues

  Both run in a cloud sandbox that can run `npm`, Vitest and Playwright (headless), but **not Obsidian**.
- **Cloud vs local split:**

  | Cloud (any session) | Local (user only) |
  |---|---|
  | core, migration planner, fixtures, React UI via the dev page, Playwright screenshots, CI | dry-run on the real vault, filling in `resolutions.yaml`, `--apply`, and clicking through the plugin in real Obsidian |

- **Install loop:**
  1. A cloud session pushes to `main`, or opens a PR you merge.
  2. Locally: `git pull && npm run build`, or keep `npm run dev` (esbuild watch) running.
  3. In Obsidian's vault switcher, open `~/dev/grand-strategy-graph/test-vault`. It loads `dist/` through the symlink. The hot-reload community plugin picks up rebuilds without restarting. On first open, Obsidian asks you to trust community plugins.
  4. When it's good, push a tag. CI builds a GitHub Release, and **BRAT** updates the plugin in Main Vault.

  The real vault never runs an untagged build.
- **Resetting the test vault:** `git checkout -- test-vault && git clean -fd test-vault`. Note that `git clean` deletes *untracked* files there, so check `git status test-vault` first.
- **Privacy:** the repo's `.gitignore` excludes `migration-report.md`, `resolutions.yaml` and `legacy-edges.json`, because they contain real strategy content. The repo `CLAUDE.md` states that real-vault outputs are never committed.

## Stray items found (reported, not touched)

- `~/Obsidian/Main Vault/FP-2 Multi-billion dollar AI company.md`: an empty file at the vault root, probably created by clicking an unresolved link. Five bets link to it instead of the real FP-2.
- `[[A-19 Testing new assumption]]` in B-1: points to a note that doesn't exist.

## Change Log

- **2026-09-30**:
  - **Context:** settle open items and set up the repo.
  - **Actions:** resolved O1–O3 into D12/D13. Added D10/D11. `git init` at the plugin folder, remote `origin` added, local `main` based on `origin/main` (LICENSE-only initial commit). Plugin files left untracked, nothing committed or pushed. Test-vault seeding was interrupted by the user before it started.
  - **Decisions:** no feature branch (user). Body serves dropped instead of mapped to `ultimately-serves`. The survey shows 12/24 bets differ, so the report will list those links as dropped.
  - **Verification:** `git status` showed only the three untracked plugin files.
- **2026-09-30**:
  - **Context:** the user flagged that a test vault nested inside the real vault's `.obsidian` is awkward.
  - **Actions:**
    - Moved the repo to `~/dev/grand-strategy-graph` (fresh clone).
    - Removed the `.git` and `LICENSE` that this session had created in `Main Vault/.obsidian/plugins/strategy-bet-creator`; its three plugin files are untouched.
    - Seeded `test-vault/` with `ANOMALIES.md`, the `dist/` symlink and `.gitignore`.
  - **Decisions:** the real vault gets only tagged releases via BRAT, and the test vault runs `dist/` through a symlink (D10/D11 rewritten).
  - **Verification:** all test-vault frontmatter and the canvas parse (PyYAML/JSON). `git add -n` shows the symlink and test vault are tracked and `dist/` is ignored. Unverified: test vault not yet opened in Obsidian (needs user action).

- **2026-10-01**:
  - **Context:** Phase 0 (repo bootstrap, TS port with byte parity), run as a Claude Code on the web session.
  - **Actions:**
    - Moved the shipped `main.js` byte-for-byte to `tests/legacy/main.js` as the oracle, `styles.css` to `src/`; `manifest.json` stays at the root.
    - Wrote characterization tests *before* porting (separate commit) over `test-vault/`: pure helpers, content builders, write plans, full create flows (write order, notices, console, bytes of every touched file), modal validation and plugin registrations. 41 goldens in `tests/characterization/__golden__/`.
    - Ported to TS: `src/core/` (pure; planners take a structural `VaultLike`), `src/obsidian/` (modals, create flows), `src/main.ts`. Toolchain: TypeScript 7, esbuild, Vitest 5, React 19 installed for Phase 5.
    - Added `ci.yml` (typecheck, test, build on PRs and `main`), `release.yml` (tag → checks → GitHub Release with the three BRAT files; fails if the tag doesn't match `manifest.json`/`package.json`), and a repo `CLAUDE.md`.
  - **Decisions:**
    - Work was pushed to the session branch `claude/busy-heisenberg-og8u70` rather than `main` (cloud-session setting; D10 still describes the user's local flow).
    - `tests/legacy/main.js` stays until Phase 4 deliberately changes output.
    - Bundle is not minified, like the legacy plugin, so dev-console errors stay readable. Revisit in 5a when React Flow and ELK are bundled.
    - TS 7 always enables `esModuleInterop`, which makes `obsidian.d.ts`'s `moment` non-callable at the type level. The cast is isolated in `src/obsidian/today.ts`.
    - `src/ui/` and `tools/` are created by the phases that first need them.
  - **Verification:** `npm run typecheck`, `npm test` (68 tests: each case runs on legacy and port against the same goldens, plus an end-to-end test that builds the real bundle in memory and drives it through its commands) and `npm run build` all pass. Two deliberate mutations of the port (bet log line, section insertion) each failed the suite. Unverified: the first CI/release run on GitHub.
- **2026-10-01**:
  - **Context:** Phase 0's manual **Verify**: real-vault byte identity.
  - **Actions:** the user ran the old plugin and the new `dist/` build in Obsidian on a throwaway copy of the real vault (outside the vault, git-snapshotted, Sync off). Same inputs in both runs, compared with `git diff` excluding `.obsidian`.
  - **Decisions:** none.
  - **Verification:** **Create new Bet**: identical. The first attempt differed only in dates (run A and run B were done on different days) and in an `[[A-28 …]]` backlink from an assumption step that was skipped in run B. **Create new Assumption**: re-run with both runs on the same day, no differences. Phase 0 manual check passed.

- **2026-10-01**:
  - **Context:** Phase 1 (schema v2 + pure graph core), run as a Claude Code on the web session.
  - **Actions:**
    - `src/core/schema.ts` (types, status lists, relation table), `links.ts` (wikilink parsing and Obsidian-style link-path resolution), `frontmatter.ts`, `graph.ts` (`buildGraph`), `smells.ts` (`findSmells`), `adapter.ts` (`VaultAdapter`), `memory-adapter.ts`.
    - Adapters: `MemoryAdapter` (core), `FsAdapter` (`tools/fs-adapter.ts`, reads a folder, never writes), `ObsidianAdapter` (`src/obsidian/adapter.ts`, built but not yet registered anywhere; Phase 5a wires it in).
    - Added the `yaml` dependency (frontmatter parsing for the Memory/Fs adapters; the plugin bundle doesn't import it yet).
  - **Decisions:**
    - `NoteRecord.resolvedLinks` maps each frontmatter linkpath to the resolved vault path or null; the core never sees a vault. Adapters resolve links, scoped to `Strategy/` for records but across the whole vault for targets, so the phantom root note resolves and is reported as `non-strategy-target` (D13).
    - Notes without `type` are skipped silently; an unknown `type` is an issue. A note without `id` is keyed by its path and flagged, so positions never rest on a filename.
    - Relation table (`RELATIONS`): which types may carry each field and which targets are valid. A violation is an issue and creates no edge. Scalar values are read as one-element lists. Legacy `next sequel` is not read.
    - Smell semantics: "active" is `status: active` exactly (not `extended`). `orphan-bet` needs a `serves` chain to a fixed point, so `ultimately-serves` alone doesn't clear it. `unreached-fixed-point` means no incoming `serves` edge from any node. Dates compare by their `YYYY-MM-DD` part; `today` is passed in.
    - The test vault is legacy format and has no v2 relations, so smells are tested on `tests/support/v2.ts`, a hand-written v2 version of it, until Phase 2's planner can generate it. The legacy test vault is still run through `buildGraph` to pin the issues its anomalies produce.
  - **Verification:** `npm run typecheck`, `npm test` (116 tests, 48 new) and `npm run build` pass; the Phase 0 goldens are untouched. Unverified: `ObsidianAdapter` against the real `metadataCache` (only a fake is tested; needs the user to open the test vault once a command uses it).

- **2026-10-01**:
  - **Context:** Phase 2 (migration planner + parity oracle, dry run only), run as a Claude Code on the web session.
  - **Actions:**
    - `npm run migrate -- --vault <path> [--resolutions <file>] [--out <dir>]` (`tools/migrate.ts`, logic in `tools/migrate/`). It writes `migration-report.md`, `resolutions.yaml`, `migration.diff`, `legacy-edges.json` and `migration-plan.json` (sha256 of every touched file before/after, for Phase 3's hash guard) to `--out`, default `./migration-out`. It refuses an output folder inside the vault and refuses `--apply`.
    - `src/core/gsmap.ts`: `.gsmap` format v1 (`positions` by id, `cards` text/note-ref/link, `frames`, `links` with card or note ends), shared with Phase 5a.
    - Parity gate (`tools/migrate/parity.ts`) runs `buildGraph` over the planned vault. Checks: no refused files; zero unclassified edges; no open questions; every edge classified as a relation is in the planned graph; **every planned relation is backed by an oracle edge or an answer** (nothing invented); prose outside the three sections and unmanaged frontmatter keys unchanged; every canvas node placed; every `.gsmap` link present.
    - Tests: 70 new (`tests/migration/`). One per `ANOMALIES.md` row; unit cases for each stop/question kind; a fixture `resolutions.yaml` that uses every kind of answer; idempotency (planning the planned vault changes nothing); goldens of the report, skeleton, diff, `.gsmap` and oracle over the test vault; a CLI test showing the vault's bytes are unchanged.
  - **Decisions:**
    - Every legacy edge gets exactly one fate: `written` (with field, holder, target), `dropped` (with reason), `kept` (D13), `gsmap-link`, `open` (waiting for an answer) or `unclassified` (stop). The oracle also reads v2 fields already present (`next`, `requires`, `assumptions`, `ultimately-serves`), so re-runs are idempotent.
    - Malformed, dangling and self-loop links are **left out of the planned frontmatter** until answered (`drop`, or `retarget: "[[…]]"`, which is re-checked against the relation table).
    - `serves` to any non-strategy note, not only the FP-2 phantom, is kept as is (D13). Any other relation to a non-strategy note, or a source/target type the relation table doesn't allow, is `unclassified`.
    - Canvas: an unlabelled note↔note edge counts as "other label". It matches an existing relation in either direction, or becomes a question (`drop`, `annotate` = keep it as a `.gsmap` link between the two notes, or `relation: <field>`). An "On kill" edge adds `next` only when the bet has none; if the bet has a different `next`, it's a question. Edges touching a group, and unknown node types, stop the migration. A second canvas node for the same note becomes a note-reference card. Canvas colors and sizes of strategy-note nodes are not carried over (status drives color from 5b).
    - "AND" junction: a text card whose text is `AND`. If the notes already state every `requires` (as in the test vault), there's nothing to answer; otherwise it's a question (`requires` / `none`).
    - A managed section with anything besides links and the template prompt lines (`Which fixed point…`, `*Check linked mentions…*`) is a question (`remove` / `keep`). Until it's answered, the section stays. Its links are read either way.
    - Ids: an explicit `id` is kept, Current Position gets `CP` (as in `tests/support/v2.ts`), others come from `<PREFIX>-<n>` in the basename with `parseIds` collision rules. Collisions and names with no id are questions. Unknown statuses are questions too.
    - Frontmatter is edited through the `yaml` Document API with no line folding. A note whose YAML doesn't re-serialize byte for byte when unchanged is refused (stop), not reformatted. New relation keys go in schema order (`serves`, `ultimately-serves`, `requires`, `next`, `assumptions`). Existing list nodes keep their style; `next` stays a scalar. Forward assumption lists keep their order, and reverse-only entries are appended.
    - Templates (`Templates/`, `type: bet|assumption`) are part of the plan, so Phase 3 only writes planned content. They get empty `id` (and `requires`/`assumptions` for bets), `next sequel → next`, and the same section edits.
    - The `## Depended On By` replacement is `LIST FROM "Strategy" WHERE contains(assumptions, this.file.link) SORT file.name ASC`.
  - **Verification:** `npm run typecheck`, `npm test` (186 tests) and `npm run build` pass; Phase 0/1 goldens untouched. On the test vault the gate passes with the fixture answers: 51 legacy edges, 0 unclassified, 21 files planned. Without answers it fails only on the 7 open questions, and its graph equals the hand-written v2 vault except B-6's kept phantom link (D13). Five deliberate planner mutations (no union, bets→`assumptions`, merging body serves, a lost blank line, writing an unanswered link) each failed the suite. **Not yet done (user, local):** the run on a *copy* of the real vault, reviewing its report and filling in `resolutions.yaml` until the gate passes. Any `unclassified` row or refused file there is a new decision to bring back. Unverified: the Dataview block rendering in Obsidian (Phase 3's Verify).

- **2026-10-02**:
  - **Context:** first Phase 2 dry run on a copy of the real vault (run locally by the user): 193 legacy edges, 56 files, 23 open questions, exit 2.
  - **Actions:**
    - Fixed a planner bug the gate caught (`relations-present`, 2 failures): a body `## Serves` link to a non-strategy note that is also in frontmatter `serves` (B-3, B-4 → phantom FP-2) was classified `written` instead of `kept` (D13), because `has()` also counts kept frontmatter links. Regression test added.
    - Four canvas edges touching a group stopped the run (`unclassified`). User decided D14: drop them. Implemented as fate `dropped`.
    - `Strategy/Strategic Inbox.md` (`type: strategic-inbox`) showed as an `unknown-type` error in the planned graph. User decided D15: a known non-graph type (`IGNORED_TYPES` in `src/core/schema.ts`), skipped by `buildGraph` and logged as info by the planner.
    - Test vault: B-6 now repeats its phantom link in the body `## Serves`; the canvas gains e18 (B-6 → "Studio route", "On Kill") and e19 ("Studio route" → B-4); `Strategy/Strategic Inbox.md` added. `ANOMALIES.md` updated. Migration goldens regenerated: 54 legacy edges (was 51), 2 more dropped, 1 more kept, one info finding; Phase 0/1 goldens unchanged.
  - **Decisions:** D14, D15.
  - **Verification:** `npm run typecheck`, `npm test` and `npm run build` pass. Not yet done (user, local): re-run the dry run on the vault copy with this fix, then answer the 23 open questions until the gate passes. The `{{DATE}}` YAML warning comes from two non-strategy files (`obsidian-task-workflow.md`, `Templates/Project Hub Template.md`) and is harmless.

- **2026-10-02**:
  - **Context:** Phase 2 parity gate on a copy of the real vault, after the D14/D15 fixes (run locally by the user).
  - **Actions:** the user answered all 23 questions in `resolutions.yaml` (5 link questions, 1 "AND" junction, 17 canvas-only edges) and re-ran the dry run with `--resolutions`.
  - **Decisions:** the user's answers, kept in their local `resolutions.yaml` (never committed).
  - **Verification:** **parity gate passed**, exit 0: 193 legacy edges, 56 files to change, 0 of 23 questions open, all 8 checks `ok`. Remaining for Phase 3: apply from this plan with its hash guard; if the real vault changes first, re-run the dry run on a fresh copy.

- **2026-10-02**:
  - **Context:** Phase 3 (apply the migration), built as tooling in a Claude Code on the web session. The real-vault apply itself is the user's local step and **has not been run**.
  - **Actions:**
    - `npm run migrate -- --vault <path> --resolutions <file> --apply [--plan <file>] [--backup-dir <dir>]` (`tools/migrate/apply.ts`). It re-plans the vault, requires the parity gate to pass, and requires every touched file to hash as the reviewed dry run's `migration-plan.json` saw it (before and after). Then it copies `Strategy/`, `Templates/`, the canvas and the files kept links resolve to (the phantom FP-2) to `<backup-dir>/<timestamp>/` (default `~/strategy-backups`, refused inside the vault), verifies the copy, writes the planned files through a temp-file rename, and re-checks the live result: bytes as planned, `The Map.canvas` untouched, a re-plan changes nothing, the gate passes. It writes `migration-applied.json` to `--out`.
    - Templates are part of the plan since Phase 2, so Phase 3's step 4 needs no separate code.
  - **Decisions:** `--apply` stops with nothing written on any mismatch (the "escalate/stop" condition). The dry run's `--out` default doubles as the plan location, so the same two commands with and without `--apply` are the whole workflow.
  - **Verification:** `npm run typecheck`, `npm test` and `npm run build` pass. New tests apply to temp copies of `test-vault/`: backup contents, exactly the planned files written, canvas untouched, idempotent re-plan, and refusals (late edit, tampered plan hash, plan whose dry run didn't pass, open questions, backup inside the vault, missing plan) each leave the vault byte-identical. Two guard mutations (skipping the before-hash check, skipping a backup file) fail the suite; the first only after adding a test with a tampered hash, since a late edit also changes the recomputed `after`. Unverified (user, local): the run on the real vault, then Phase 3's Verify in Obsidian (Properties panel, the Dataview "dependents" block).

- **2026-10-02**:
  - **Context:** Phase 4 (creation flows write schema v2), run in the same session.
  - **Actions:**
    - `src/core/actions.ts`: `planBet`, `planAssumption`, `planRoute`, `planMilestone` turn a form into an ordered list of writes (`create` a note, or `add-link` to a frontmatter list of an existing note). `src/obsidian/create.ts` only executes them: `vault.create`, `fileManager.processFrontMatter`, open, notice. `insertIntoSection` and `sections.ts` are deleted: nothing writes into another note's body any more.
    - Bets are written as v2: `id`, `serves`, optional `ultimately-serves`, `requires`, `next`, `assumptions` in the frontmatter, no `## Serves` / `## Assumptions…` sections. Assumptions get `id` and the Dataview "dependents" block, and no bet links. A reused assumption is just listed in the new bet; creating an assumption for existing bets appends it to each bet's `assumptions`. `BetModal` gains pickers for `ultimately-serves`, `requires` and `next`.
    - New commands "Create new Route", "Create new Ghost Route", "Create new Milestone" (`NoteModal`), writing `Strategy/Routes/R-<n>` and `Strategy/Milestones/M-<n>`. Routes carry `status: active|ghost`; milestones carry no status (schema). Assumptions may be attached to bets, fixed points, routes and milestones.
    - Form picks are checked against the relation table by folder, so a bet can't be written with `requires` pointing at a fixed point, etc.; a refusal creates nothing.
    - `tests/legacy/main.js`, `tests/support/legacy.ts` and `impls.ts` removed, as planned for Phase 4.
  - **Decisions:**
    - **Golden diff (deliberate):** bet, assumption, route and milestone note goldens; the `plans/` and `flows/` goldens; `modals/*` (new fields, `dependentFiles` replaces `betFiles`, three new commands, `NoteModal`); `pure.json` loses only the `insertIntoSection` key (every other helper's output is identical, checked key by key). Not changed: `get-files-in-folders`, `bet-refused`, `bet-empty-vault`, `assumption-refused`, `assumption-failure` (the error paths and messages are as before, except the console line, which now names the kind: "failed part-way through bet creation"). The old reused-assumption backlink goldens (`bet-mixed` A-1/A-4/A-7) are gone because those notes are no longer edited.
    - New ids: routes `R-<n>`, milestones `M-<n>`, allocated from basenames like bets and assumptions. A note whose `id` differs from its basename isn't considered; the planner reports those as collisions.
    - `dependedOnByBlock` moved from the migration planner to `src/core/content.ts`, so notes created by the plugin and notes migrated by Phase 2 hold the same block.
  - **Verification:** `npm run typecheck`, `npm test` (185 tests, run with `CI=true` so no snapshot is written) and `npm run build` pass. `tests/characterization/v2-graph.test.ts` creates bets, assumptions, routes and milestones in the hand-written v2 vault and checks `buildGraph` reports no new issues and every chosen relation is an edge of its kind; three mutations (dropping `requires`, dropping the `add-link` writes, a misspelled `type`) each fail it. Unverified (user, local, needs Obsidian): real `processFrontMatter` — the fake re-dumps YAML its own way (e.g. `next sequel: null`), so whether Obsidian keeps empty keys and key order as written is a manual check on a throwaway copy; the new modals' layout; the three new commands.

- **2026-10-03**:
  - **Context:** the user clarified what the old canvas "routes" were: placeholders for starting something, not a step between bets, and of no strategic value. The strategy is bets, assumptions and their relations; the `serves` chain is what defines the routes.
  - **Actions:** plan only. D4 narrowed, D16 added. Removed the `route` type and its schema block, the ghost status, the route/ghost-route commands (Phase 4), the routes layer in the ELK order (5a), the ghost node style (5b), "route"/"ghost route" as promote targets (7), and "ghost" from the dashed-edge rule. The review walk (8) now follows `serves` chains. Earlier change-log entries are left as written.
  - **Decisions:** D16. `milestone` is unchanged, since the user only spoke about routes; it is an open question whether it stays.
  - **Verification:** the plan and the code now disagree, on purpose and temporarily. Still implementing routes: `src/core/schema.ts` (type, `route` status, relation lists) on `main`; and, in PR 1, `planRoute`, `ROUTES_FOLDER`, the route/ghost-route commands and `NoteModal`, plus their goldens. Not yet removed.

- **2026-10-03**:
  - **Context:** the user asked how milestones work and wanted them kept as checkpoints to begin further bets from. The plan had no definition (only the type, `serves`/`assumptions` fields, layout order and a creation command), and the attached `Grand_Strategy_Meta-Framework.md` has no milestone concept either (its closest line is "a general outline of big actions and directions").
  - **Actions:** plan only. Added D17 and a milestone schema block; widened `requires` to point at bets or milestones (D7 note); added the milestone node style (5b), the bet form's milestone picker (4) and the `requires-open-milestone` smell (8). The user confirmed the dashed-edge rule stays as "Unverified serve: dashed".
  - **Decisions:** D17: bets serve a milestone, later bets `require` it, the milestone serves a fixed point or another milestone, and it has `status: open | reached`.
  - **Verification:** none needed for a plan edit. Code not yet changed, so it disagrees with the plan: `src/core/schema.ts` has no milestone status, `requires` is bet→bet only, and `serves` from a milestone may point at a bet (the relation table needs per-source targets for that). In PR 1, `planMilestone` and the milestone form write no status and don't offer milestones under `requires`. With D16 this is one batch of code changes still to make.

## Decisions Log

*(For the user's own hand only.)*
