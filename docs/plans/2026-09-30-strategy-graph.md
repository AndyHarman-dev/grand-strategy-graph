---
status: Pending
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
| D4 | Routes, milestones, ghosts and current position are **real notes** with a `type`. |
| D5 | Serves is split in two: `serves` (direct parent) and `ultimately-serves` (the far fixed point). |
| D6 | Statuses are **normalized to canvas_rules**: `asleep → dormant`, `cancelled → killed`. |
| D7 | New bet→bet relation `requires` (prerequisites; the canvas "AND" diamond becomes several `requires` links). Assumptions can attach to any node type, including fixed points. |
| D8 | Canvas migration: copy positions into `.gsmap`, migrate canvas text cards and groups, and support **free cards**. Free cards exist only on the graph (stored in `.gsmap`) and can be promoted to a real note. |
| D9 | Development happens in a GitHub repo using Claude on GitHub / Claude Code on the web. **The real vault never goes into the repo**; cloud work runs against synthetic fixtures only. |
| D10 | The repo lives at `~/dev/grand-strategy-graph`, remote `https://github.com/AndyHarman-dev/grand-strategy-graph.git`, branch `main`. No feature branch (user instruction, 2026-09-30). esbuild writes to `dist/` (gitignored). The real vault's plugin folder is **not** the repo: it gets tagged releases only, via BRAT. |
| D11 | A synthetic **test vault** lives at `test-vault/` in the repo. It is legacy format and covers every anomaly class (see `test-vault/ANOMALIES.md`). Its plugin folder `test-vault/.obsidian/plugins/strategy-bet-creator` is a committed **symlink to `../../../dist`**, so it always runs the latest build. The symlink targets `dist/`, not the repo root, which would create a loop. The test vault is both the test fixture and the vault to open in Obsidian for manual testing. |
| D12 | The body `## Serves` list is **dropped** without being merged (user: "it's just the same as the frontmatter"). Body-only links still appear in the migration report as *dropped*, so the parity gate accounts for them. `ultimately-serves` stays in the schema as an optional field, set by hand or from the graph; the migration doesn't fill it. |
| D13 | Assumption status `undeterminable` is kept (styled gray). Links to the phantom `FP-2 Multi-billion dollar AI company` are **left as they are**: no retargeting, only listed in the report. |
| D14 | **The UI design is locked** (2026-10-01) to the design canvas [Grand Strategy Graph](https://claude.ai/artifact/381wJ3mBWBE3PY9SWMMNUU) and its five mockups, copied into `docs/design/mockups/`. See **UI design** below. The mockups are the visual spec, not code to port: their hex colours stand in for Obsidian CSS variables. |
| D15 | **Components first.** Every React component is built and screenshot-tested in the dev gallery (`npm run dev:web`, no Obsidian) before it is wired into the plugin. Phase 5 is reordered to match: 5a = components + gallery, 5b = Obsidian integration. |
| D16 | The **inspector lives inside the graph view** (right-hand panel, 360 px), not in Obsidian's sidebar, so it travels with the tab. Right-click menus, the relation picker and confirm dialogs use Obsidian's native `Menu` and `Modal`. Hover previews use Obsidian's page preview (`hover-link`). |

### Schema v2 (target)

```yaml
# Every strategy note
id: B-10                  # stable key used for positions; never derived from the filename again
type: bet | assumption | fixed-point | route | milestone | current-position
status: ...               # per type, below

# bet
status: active | dormant | won | killed | extended
started, deadline, expected-result      # unchanged
serves: ["[[B-11 …]]"]                  # direct parents (bet | route | milestone | fixed-point)
ultimately-serves: ["[[FP-3 …]]"]       # far anchor(s); fixed points only
requires: ["[[B-1 …]]"]                 # prerequisite bets
next: "[[B-16 …]]"                      # sequel activated on kill (renamed from `next sequel`)
assumptions: ["[[A-1 …]]"]              # also allowed on fixed-point / route / milestone

# assumption
status: unverified | confirmed | falsified | undeterminable   # undeterminable kept (D13)
created, verify-by                       # unchanged; existing datetime values are left as they are

# route
status: active | ghost                   # ghost = suspected, unexplored route
serves: ["[[FP-1 …]]"]
```

Edges are drawn per canvas_rules. Bet→serves: solid. Ghost or unverified serve: dashed.
`next`: dashed with an "on kill" label. Assumption leader: thin dashed with no arrowhead.
`requires`: a distinct dotted style. `ultimately-serves`: hidden by default; shown when
toggled, or when a bet has no `serves` chain reaching a fixed point. Exact strokes and
colours: **UI design → Edges**.

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

O1→D13, O2→D12, O3→D13 (resolved 2026-09-30).

- **O4 (needed by Phase 4).** `id` prefixes for routes and milestones. The schema only shows `B-`, `A-` and `FP-`, and the mockups use `[M-id]` as a placeholder. Proposal: `R-n` for routes (ghost routes included) and `M-n` for milestones.

---

## UI design (D14–D16)

**Source of truth:** the design canvas [Grand Strategy Graph](https://claude.ai/artifact/381wJ3mBWBE3PY9SWMMNUU), with copies of its artboards in `docs/design/mockups/`. The copies are Design Component files (`.dc.html`) and only render on the canvas. Read them for exact sizes, spacing and CSS. Each component below names the artboard that specifies it.

| Artboard | Specifies | Built in |
|---|---|---|
| `Main.dc.html` | The assembled graph tab: frames, nodes, edges, toolbar, controls, minimap, smells panel, inspector. Interactive: click to select, change statuses and dates, kill and activate next, toggle ultimately-serves. | 5a (shell) → 5b, 6, 8 |
| `Nodes.dc.html` | Every node type in every status, plus the selected, smell, issue, overdue and hover-handle states. Free cards, diamond, note reference, frame. The status dropdown and date picker on a node. | 5a, 6, 7 |
| `Edges.dc.html` | One row per relation, plus selected and dimmed states. The relation picker shown after drawing an ambiguous edge. | 5a, 6 |
| `Inspector.dc.html` | Inspector states for a bet, an assumption and a free card (promote to note). | 6, 7 |
| `Overlays.dc.html` | Bet and assumption right-click menus, the kill-and-activate confirm dialog, hover preview, review walk bar. | 6, 8 |

The fixture data in the mockups is the test vault (`test-vault/`) as planned by Phase 2, so the screenshots in Phase 5a can be checked against it. Two mockup details are **not** in the fixture: B-8's `ultimately-serves: FP-2` was invented to demonstrate the toggle, and node positions were placed by hand. The real positions come from `The Map.canvas` through the `.gsmap` migration.

### Theme

No colour is hard-coded in the plugin. `src/ui/theme.css` maps every mockup token to an Obsidian variable:

| Mockup token | Obsidian variable |
|---|---|
| `--background-*`, `--text-normal/muted/faint/accent`, `--interactive-accent`, `--text-on-accent` | same name |
| `--red-rgb` … `--purple-rgb`, `--gray-rgb` | `--color-red-rgb` … `--color-purple-rgb`; gray = `--text-faint` |
| `--red-text` … (status text on a tint) | `color-mix(in srgb, var(--color-X) 70%, var(--text-normal))` in light mode, `var(--color-X)` in dark mode. Pill text keeps 4.5:1 contrast in both. |
| `--node-bg` / `--node-bg-alt` | `--background-secondary` / `--background-primary-alt` |
| `--edge` | `--text-faint` |
| `--canvas-dot`, `--frame-*` | `--canvas-dot-pattern`, `--background-modifier-border` |
| fonts | `--font-interface`, `--font-monospace` (ids and dates) |

React Flow's `--xy-*` variables are set from the same tokens. The dev page ships `src/ui/dev/obsidian-vars.css` with the dark and light values from the mockups, so one stylesheet is tested in both themes.

### Layout of the graph tab (`Main`)

- The view is the graph pane with the **inspector** to its right (360 px; it shows an empty state when nothing is selected).
- On the graph pane:
  - a dot-grid background
  - a **toolbar** top-left: Fit view · Ultimately serves (toggle) · Smells (toggle, shows the count) · Add card · Review walk
  - React Flow **controls** bottom-left: zoom in, zoom out, lock positions
  - a **minimap** bottom-right, coloured by node status
- The view header shows a summary such as "8 bets · 4 active · 7 assumptions · 2 fixed points".

### Nodes (`Nodes`)

| Type | Component | Size (px) | Look |
|---|---|---|---|
| bet | `BetNode` | 220×84 | Row 1: id (mono) · deadline · status pill. Row 2: title, up to two lines. Border tinted by status. |
| assumption | `AssumptionNode` | 200×60 | Sharper corners (4 px). Row 1: id · verify-by · pill. Row 2: title, one line with ellipsis. |
| fixed-point | `FixedPointNode` | 200×96 | Purple double ring, 20 px radius, lock icon, "FIXED POINT · FP-n". Locked, never draggable. |
| current-position | `CurrentPositionNode` | 170×84 | Neutral, "YOU ARE HERE" pin, a two-line summary. Placed leftmost. |
| route | `RouteNode` | 240×64 | Blue capsule. |
| ghost route | `RouteNode` (ghost) | 240×64 | Dashed gray capsule, italic title, mostly empty. |
| milestone | `MilestoneNode` | 200×64 | Rotated-square marker, id · date, title. |
| free card | `CardNode` | text width × 44 | Tinted by its canvas colour (1–6 → red, orange, yellow, green, cyan, purple); optional dashed border. |
| diamond card | `CardNode` (diamond) | 64×64 | Rotated square with centred text (the old "AND"). |
| note reference | `NoteRefNode` | 170×56 | File icon, basename, "Note reference". |
| frame | `FrameNode` | resizable | Faint fill and border, label top-left, resize handle. Sits behind nodes. |

**Status colours.** For bets:

| Status | Colour | Extra styling |
|---|---|---|
| active | green | — |
| dormant | gray | faded to 66% |
| won | cyan | check mark in the pill |
| killed | red | faded to 55%, title struck through |
| extended | yellow | — |

For assumptions: unverified amber, confirmed green, falsified red, undeterminable gray.

**Dates shown on nodes.** These turn orange:
- an overdue bet ("Overdue <date>")
- an unverified assumption whose verify-by is today ("Verify today") or has passed ("Verify-by passed")

`today` is a prop, never `new Date()` inside a component.

**Badges.** Each sits on the node's top-right corner:
- orange **smell badge** with the count; its tooltip lists the smell kinds
- gray **issue badge** "?", for problems from the migration report that the graph still shows, such as a link to a phantom note

**States.**
- **Selected:** accent ring with a 2 px gap.
- **Hover:** source and target handles appear on the node's sides.
- Nodes are `<button>`s with an `aria-label` such as "Bet Get a D7 visa, active, 1 smell".

### Edges (`Edges`)

| Relation | Stroke | Arrow | Label |
|---|---|---|---|
| `serves` | solid, `--edge`, 1.6 | yes | — |
| `serves` from a ghost route or unverified | dashed 6/5 | yes | — |
| `next` | orange, dashed 7/5 | yes | "on kill" pill |
| assumption leader | `--text-faint`, 1.1, dashed 3/4 | **no** | — |
| `requires` | purple, round dots (0.1/5, width 2.2) | yes | — |
| `ultimately-serves` | purple, 75% opacity, dashed 12/6 | yes | "ultimately serves" (hidden until toggled) |
| free-card link | `--text-faint`, dashed 6/4 | yes | its canvas label, if any |

- **Arrow direction:** from the note that holds the field to the note it names. The exception is `requires`, which points at the bet that needs the prerequisite.
- **Selection:** edges touching the selected node turn accent-coloured at width 2.6. All other edges dim to 38%.
- **Dormant and killed sources:** edges leaving these nodes are always dimmed.
- **Arrowheads** are drawn as path triangles, not SVG markers.
- **Parallel edges:** ports are spread 16 px apart along a node's side, so two edges between the same pair (B-3 → B-4 `serves` and `requires`) don't overlap.

### Inspector (`Inspector`, `Main`)

Sections, top to bottom:

1. **Header:** type pill, id, "Open in split", close.
2. **Title.**
3. **Status:** a segmented control. A bet has five segments; an assumption has four.
4. **Smell and issue callouts:** one per smell, each with its kind and a one-line reason.
5. **Kill and activate `<next>`:** a red button. It appears when a bet has a `next` and isn't killed or won.
6. **Fields:** a two-column grid.
   - bet: *I believe continuing* (X), *will produce* (Y), *within* (Z), expected result, started, deadline
   - assumption: statement, *How I'd know it's false*, created, verify-by
   - fixed point: statement, established
   - card: text
   - A missing verify-by that gates an active bet gets an orange outline.
7. **Relations:** one row per frontmatter field, each with "+ Add", and chips with ×.
   - bet: Serves · Requires · Next (on kill) · Assumptions · Ultimately serves
   - Computed rows are read-only and tagged *computed*: Served by · Required by · Sequel of (bets), Depended on by (assumptions).
   - Clicking a chip selects that node. An unresolved link (phantom note) shows as a dashed chip.
8. **Log:** the dated lines, plus an input. Enter or "+ Log entry" appends `YYYY-MM-DD: text` under `## Log`.
9. **Promote to note** (free cards only): Route · Ghost route · Milestone · Bet · Assumption, then "Create <type>".
10. **Footer:** Open in split · Open note.

### Menus, dialogs, panels (`Overlays`, `Main`)

- **Bet right-click menu** (Obsidian `Menu`):
  - Open in split · Reveal in file explorer
  - New sequel bet (pre-fills `next`) · Add assumption · New bet serving this · Set status ▸
  - **Kill and activate `<next>`** (red), with the sequel's title as a subtitle
- **Assumption right-click menu:** Mark confirmed · **Mark falsified** (subtitle names the dependents it flags) · Mark undeterminable · Set verify-by date · Open in split.
- **Kill and activate dialog** (Obsidian `Modal`):
  - lists both status changes (active → killed, dormant → active)
  - lists both log lines that will be written
  - "Both notes change together, or neither does."
  - Cancel · Kill and activate
- **Relation picker** (Obsidian `Menu` at the drop point), for ambiguous pairs only:
  - title such as "B-3 → B-4 · bet to bet, pick one"
  - Serves (S) · Requires (R) · Next (on kill) (N)
  - Assumption, disabled unless one end is an assumption
- **Hover preview:** Obsidian's native page preview of the note.
- **Smells panel:** a floating panel top-right of the graph, opened from the toolbar.
  - One row per smell, then the issues. Each row shows kind · id + title · reason.
  - Clicking a row selects and centres the node.
- **Review walk bar:** pinned to the bottom of the graph.
  - Step dots and "n of N · Fixed points, then routes, then bets".
  - The current node's id and title, and what it is served by.
  - Previous · Next: `<id>` · Exit.
  - The current node is focused and centred; nodes that aren't its neighbours dim.

### Fixture acceptance

`npm run dev:web` on the test vault (planned to v2, `today` = 2026-10-01) must show these smells and issues:

| Node | Smell or issue | Why |
|---|---|---|
| B-1 | gating violation | relies on A-2: unverified, no verify-by |
| B-4 | gating violation | relies on A-2 (unioned in from A-2's reverse list) |
| B-3 | falsified dependency | relies on A-3 |
| B-7 | orphan | its placeholder `[[...]]` is not migrated |
| B-8 | dormant, not a sequel | dormant, and no bet names it as `next` |
| B-6 | issue badge | serves the phantom `FP-2 Profitable pottery business` |

A-5 shows "Verify today". Setting A-2's verify-by clears both gating violations. Killing B-1 from the inspector activates B-2.

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

  **Scope (from the design, D14):**
  - Orphan checks skip won and killed bets.
  - Gating, falsified-dependency and overdue checks apply only to active and extended bets.
  - Smells are recomputed from the current frontmatter on every change, so editing a status or date in the graph adds or clears them at once.
  - `today` is a parameter, never read from the clock inside `smells.ts`.
  - Migration-report problems that survive into v2 (a phantom target) are returned as `issues`, separate from smells.
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
  - New commands: "New route", "New milestone", "New ghost route".
- **Solutions.** All creation goes through `src/core/actions.ts`, a set of pure "intent → planned writes" functions, executed by the adapter. The graph's quick actions in Phase 6 reuse exactly these.

## Phase 5a — Graph components + dev gallery (no Obsidian)

**Model: Sonnet 5.** Presentational React components with a fixed visual target (the mockups, D14) and fixture props. Nothing here imports `obsidian`, so all of it runs in the cloud and is checked with Playwright screenshots (D15).

- **Current State.** Phase 1 gives `buildGraph` and smells. Phase 2 gives the planner. No UI exists.
- **Desired State.**
  - `src/ui/` holds the graph-canvas components from **UI design**:
    - every node type and its states
    - the custom edges
    - frame, toolbar, controls, minimap
    - badges
    - the smells panel shell
    - a read-only inspector shell
  - `<StrategyGraph graph positions selection today onIntent>` is pure: props in, intents out (`select`, `move`, `setStatus`, `connect`, …). Phase 5b and Phase 6 attach the intents to real actions.
  - `src/ui/theme.css` uses Obsidian variables only (**UI design → Theme**).
  - `npm run dev:web` (Vite) serves two pages, each with a dark/light toggle:
    - `/`: the assembled graph tab (the `Main` artboard). It is built from `MemoryAdapter` loaded with `test-vault/` **after running the Phase 2 planner in memory**, since the graph only understands schema v2. Positions come from the planned `.gsmap`.
    - `/gallery`: one section per artboard (`Nodes`, `Edges`, and later `Inspector` and `Overlays`), with every component in every state, fed by fixture props.
- **Problems.**
  - React Flow joins every edge at one handle point, so parallel edges (B-3 → B-4 `serves` + `requires`) overlap.
  - Dates drive what's shown ("Verify today", overdue), so screenshots would change from day to day.
  - Obsidian's CSS variables don't exist outside Obsidian.
- **Solutions.**
  - A custom edge spreads ports 16 px apart along the node side and draws arrowheads as paths.
  - `today` is a prop. The dev page and the tests pin it to 2026-10-01.
  - `src/ui/dev/obsidian-vars.css` defines the dark and light values used in the mockups. It is loaded only by the dev page.
  - Playwright screenshots `/` and each gallery section in both themes and compares them with committed baselines.
- **Verify:**
  - `/` passes **UI design → Fixture acceptance** (as a Playwright test).
  - The user compares the first screenshot baselines (attached to the PR) with the design canvas and approves them.
- **Playwright:** not installed globally on the user's machine. It is added as a dev dependency in the repo. **Suggest the user does visual verification with it** after 5a, 5b and 6.

## Phase 5b — Graph view integration (React Flow in Obsidian)

**Model: Opus 5.** This is the first integration with no precedent in the repo. Correctness spans the `FileView` lifecycle, React mount/unmount, `metadataCache` change/rename/delete events, and `.gsmap` save debouncing all at once. The bugs here (stale graph after a rename, lost positions, leaks on tab close) don't fail any unit test.

- **Current State.** The 5a components render the fixture graph in the dev page.
- **Desired State.**
  - `registerExtensions(['gsmap'], VIEW_TYPE)`. Opening `Strategy.gsmap` shows the 5a `<StrategyGraph>` in a normal tab, with the inspector panel inside the view (D16).
  - The view re-derives the graph from `metadataCache` on every change, debounced.
  - Positions save to `.gsmap` on drag-end only.
  - Renames need no handling because positions are keyed by `id`. A note whose `id` changes is reported.
  - Nodes with no position are placed by **ELK** (layered, left→right: current position → routes → bets → milestones → fixed points). Pinned positions are kept.
  - Fixed points are locked (not draggable).
  - Selection, the toolbar toggles and the viewport persist per view in the `.gsmap` view state.
  - Hovering a node opens Obsidian's page preview (D16).
  - Commands: "Open strategy graph" and "Reveal note in graph".
- **Solutions.**
  - React Flow (`@xyflow/react`) + `elkjs`.
  - `.gsmap` writes go through `vault.process` with a schema version field.
  - Hover: `registerHoverLinkSource(VIEW_TYPE, …)`, then `app.workspace.trigger('hover-link', …)` from the node.
  - The plugin's `styles.css` bundles `src/ui/theme.css` and nothing else from `src/ui/dev/`.
  - On close: unmount the React root and unregister events.
- **Verify:** the user opens `test-vault/Strategy/Strategy.gsmap` in Obsidian and checks the same graph as the dev page, in both themes.

## Phase 6 — Editing from the graph

**Model: Sonnet 5.** Every edit is a Phase 4 action (an intent → frontmatter patch), unit-tested in core. The UI only dispatches intents.

Gallery first (D15): the inspector, the inline editors, the relation picker and the menus land in `/gallery` (`Inspector` and `Overlays` sections) before they are wired to Obsidian. Layouts and item lists: **UI design → Inspector** and **→ Menus, dialogs, panels**.

- **Inline on the node** (`Nodes` artboard): a status pill dropdown, and a date popover for the deadline or verify-by.
- **Inspector side panel** (on select):
  - status as a segmented control
  - smell and issue callouts
  - "Kill and activate `<next>`"
  - the fields grid. Bet X/Y/Z live in the `## The Bet` sentence: an edit rewrites only the matching bold span on that line. This is a pure function in core with golden tests.
  - relation rows with add/remove and link pickers, plus read-only computed rows (Served by, Required by, Sequel of, Depended on by)
  - the log list, with an input that appends a dated line under `## Log`
  - "Open in split" and "Open note"
  - The rendered note body (`MarkdownRenderer`) is dropped from the inspector: the hover preview and "Open in split" cover it (D16).
- **Edge drawing:** drag from a handle to a node. The relation is inferred from the source and target types:
  - bet → fixed point is always `serves`
  - assumption → anything is always `assumptions`
  - ambiguous pairs open the relation picker (Obsidian `Menu`) at the drop point
  - Deleting an edge removes the link.
- **Context menu** (Obsidian `Menu`, item lists in **UI design**):
  - New sequel bet (pre-fills `next` on the source)
  - Add assumption
  - New bet serving this
  - Set status
  - **Kill → activate next**: one atomic action that sets the bet to `killed`, the `next` bet to `active`, and writes log lines in both notes. It is confirmed in a `Modal` that lists both status changes and both log lines.
  - Mark assumption falsified (dependents get flagged; the menu item names them)

## Phase 7 — Free cards, frames, promote-to-note

**Model: Sonnet 5.** Additive UI over `.gsmap` data that Phase 2 already defines. Fixture-tested.

- **Free cards:** create, edit and delete on the graph (stored only in `.gsmap`), with optional links between cards and to notes. The edge style can be set freely, since free cards carry no strategy semantics.
- **Frames:** resizable labelled regions, the old canvas groups. Purely visual.
- **"Promote to note":** a free card becomes a real note (route, ghost route, milestone, bet or assumption) via the Phase 4 actions. The card's position transfers to the new note's `id`. In the UI this is the inspector's "Promote to note" section: a type list, then "Create <type>" (`Inspector` artboard).
- Migrated canvas cards arrive here and can be promoted one by one.
- **Looks** (`Nodes` artboard):
  - cards are tinted by canvas colour 1–6 and keep a dashed border when the canvas card had one
  - the "AND" card renders as a diamond
  - note references show a file icon
  - frames sit behind nodes, with a label and a resize handle

## Phase 8 — Smell overlay + review walk

**Model: Sonnet 5.** Renders Phase 1 smells that are already tested.

- A badge on each node (orange count for smells, gray "?" for issues), plus a "Smells" panel listing:
  - orphans, unreached fixed points, gating violations, falsified dependencies, overdue bets, and dormant bets that aren't anyone's sequel
  - then the issues
  - Clicking an item selects and centres the node.
  - The panel floats top-right of the graph and opens from the toolbar button, which shows the count (`Main` artboard).
- **Review walk:** steps through fixed points → routes → bets in that fixed order, by `id` within each group (replaces canvas presentation mode).
  - The bar is pinned to the bottom of the graph and shows step dots, "n of N", the current node and what serves it, and Previous · Next: `<id>` · Exit (`Overlays` artboard).
  - The current node is centred; nodes that aren't its neighbours dim.
  - ←/→ and Esc work while the view has focus. There is no global key handler.

## Phase 9 — Retire `The Map.canvas`

**Model: Sonnet 5.** No code. This is a gate plus one user action.

- **Parity gate:** re-run the Phase 2 oracle against `The Map.canvas` and the live graph. Every canvas edge must be present as a relation or free-card link, or explicitly dropped in the report. Every canvas node must have a position, card or frame.
- Then the **user** moves the canvas into an archive folder. It is never deleted by tooling.

**Routing:** Phases 0, 1, 3, 4, 5a, 6, 7, 8, 9 → Sonnet 5 · Phases 2, 5b → Opus 5

---

## Development setup (GitHub + Claude)

- **Repo:** `https://github.com/AndyHarman-dev/grand-strategy-graph.git`, cloned at `~/dev/grand-strategy-graph` (D10).
- **Where work happens:**
  - Claude Code on the web (claude.ai/code) for the phase sessions
  - `claude-code-action` for PR review / @claude on issues

  Both run in a cloud sandbox that can run `npm`, Vitest and Playwright (headless), but **not Obsidian**.
- **Design reference:** the design canvas (D14) is the visual spec. UI sessions read `docs/design/mockups/` for exact values and link the canvas in their PRs, so the user can compare screenshots with it.
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
  - **Context:** the user wanted to see the React components and how they look together before implementing. The user approved the design ("I love it") and asked to fold it into the plan.
  - **Actions:**
    - Designed the graph UI on the design canvas [Grand Strategy Graph](https://claude.ai/artifact/381wJ3mBWBE3PY9SWMMNUU), using test-vault data planned to v2. It has five artboards: assembled tab, nodes, edges, inspector, overlays.
    - Copied the artboards to `docs/design/mockups/`.
    - Added D14–D16, O4, a **UI design** section, a smell-scope note in Phase 1, and design detail in Phases 6–8.
    - Reordered Phase 5: 5a = components + dev gallery (Sonnet), 5b = Obsidian integration (Opus). The old 5b styling work moved into 5a, and the dev harness moved from integration into 5a.
  - **Decisions:**
    - The inspector lives inside the view (D16).
    - Native `Menu`/`Modal` for menus and dialogs (D16).
    - The rendered note body is dropped from the inspector in favour of the hover preview.
    - `today` is injected everywhere.
  - **Verification:** none run. The canvas was not render-checked by Claude; the user reviewed it visually. B-8's `ultimately-serves` in the mockup is illustrative and is not fixture data.

## Decisions Log

*(For the user's own hand only.)*
