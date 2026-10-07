---
status: Pending
---

# Convert a bet into a milestone, keeping its connections

## Context

**Goal:** right-click a bet on the graph → "Convert to milestone…". The note becomes a milestone (D17) and keeps
every connection a milestone can hold: what serves it, what it serves, what it requires, what requires it, and its
assumptions. Its place on the graph and the free-card links on it stay too.

**Why this is not a one-field change** (assessment, 2026-10-07):

- A milestone has its own id prefix and folder: ids are parsed by prefix (`src/core/ids.ts`) and new milestones get
  `M-<n>` in `Strategy/Milestones/` (`planMilestone`, `src/core/actions.ts:261`). A milestone carrying a `B-` id breaks
  id numbering, so the note gets a new id, a new basename and a new folder, and every link to it has to follow.
- `PlannedWrite` (`src/core/writes.ts:16`) can't move a file or remove a frontmatter key (`set-field` with `null`
  writes `key: null`). CLAUDE.md pins the ways an existing note may change, so both are deliberate additions to
  that contract.
- `Strategy.gsmap` keys positions and note ends of links by `id` (`src/core/gsmap.ts`). A changed id leaves the
  position behind (`IdTracker`, `src/core/id-changes.ts`); there is no op that re-keys an id.
- Some bet relations have no milestone form (`RELATIONS`, `src/core/schema.ts:36`): `next` (bet → bet only) and
  `ultimately-serves` (held by bets only).

**Everything a milestone can already hold carries over unchanged** (`RELATIONS`): `serves` from bets and milestones
into it, its own `serves` (bet, milestone, fixed point), `requires` both ways (fixed points included), and
`assumptions`. So the conversion never has to translate one relation into another.

### Decisions locked (user, 2026-10-07)

| # | Decision |
|---|---|
| C1 | **`next` links block the conversion.** If the bet has a `next`, or any bet's `next` points at it, "Convert to milestone…" is disabled and says which link to remove first. Nothing is dropped or translated. (User chose this over "drop and list" and over "turn into serves/requires".) |
| C2 | **Status:** `won → reached`; `active`, `dormant` → `open`. A `killed` bet can't be converted (item disabled). |
| C3 | **Content:** `started`, `deadline`, `expected-result` and `ultimately-serves` are removed from frontmatter (an empty `next:` key goes too, C1 guarantees it is empty). Every other key (e.g. `categories`) and the whole body stay as they are; a Log line `Converted from bet B-<n>.` is appended. |
| C4 | **Identity:** the next free `M-<n>` (same allocation as `planMilestone`), basename `M-<n> <title>` where the title is the old basename without its id prefix, moved to `Strategy/Milestones/`. Every relation link to it in other notes is re-pointed, and the `.gsmap` re-keys `B-<n>` → `M-<n>` (position and links). |

### Decisions taken in this plan (open to the user's veto)

| # | Decision | Why |
|---|---|---|
| C5 | **Move first, then edit.** The write order is: move the file, then the note's own frontmatter and log, then the relation links in other notes. | If the move fails, nothing has changed. Obsidian may already re-point links during the move (its "Automatically update internal links" setting), so the link rewrites after it must be idempotent: remove the old link if present, add the new one if absent. |
| C6 | **Relation links are rewritten by the planner; prose links are left to Obsidian.** | Relation fields are the graph's data, so they are planned, tested and guaranteed. A `[[B-7 …]]` inside some note's prose follows only if the user's Obsidian setting updates links; the confirm dialog says so. |
| C7 | **One intent, `convert-to-milestone`, planned in `src/core/edits.ts`**, with the `.gsmap` re-key done by the UI after a successful outcome, the way `promote-card` follows a promotion (`StrategyGraph.tsx:1112`). | Keeps the rule "every note write comes from an intent", and keeps the map out of the note planner. |
| C8 | **A partial failure is reported, not rolled back**, as for every other intent (`performIntent`): the notice lists what was written. | Same contract as today; a rollback across a move and several notes is more risk than it removes. |

---

## Phase 1 — Write contract: move a note, remove a frontmatter key

**Model: Sonnet 5.** Two small, fully specified additions to an existing switch, and the characterization goldens fail
loudly if any existing write changes.

- **Current State.** `PlannedWrite` has `create`, `add-link`, `remove-link`, `set-field`, `append-log`,
  `replace-section`. `WriteIO` has `create`, `patchFrontmatter`, `patchBody`. `ObsidianIO` and `MemoryVault` implement it.
- **Desired State.** Two more write kinds, used only by the conversion:
  - `{ kind: 'move'; path: string; to: string }`: rename/move a note, creating the target folder if needed;
  - `{ kind: 'delete-field'; path: string; field: string }`: remove the key from frontmatter (no-op when absent).
- **Problems.** No way to move a file or remove a key today; `set-field` with `null` leaves `key: null`.
- **Solutions.**
  - `writes.ts`: add both kinds to `PlannedWrite`, `runWrite` and `describeWrite`; `WriteIO` gains
    `move(path: string, to: string): Promise<void>`. `delete-field` runs through `patchFrontmatter`
    (`delete fm[field]`), so no new IO for it.
  - `ObsidianIO.move`: refuse if `to` exists; `ensureFolder` on the target folder; `app.fileManager.renameFile(file, to)`
    (Obsidian's safe rename, which also lets the user's link setting apply).
  - `MemoryVault.move`: move the entry, refuse if the target exists. It updates no links (the planner does, C6).
  - The obsidian mock (`tests/mocks/obsidian.ts`) and fake app get `renameFile`.
  - CLAUDE.md "Hard rules": the list of ways an existing note may change gains "moved by the conversion" and
    "a frontmatter key removed by the conversion".
- **Parity gate (named step).** `tests/characterization/__golden__/` and `tests/migration/__golden__/` are unchanged;
  the full suite passes with no `-u`. New unit tests: each new write kind on `MemoryVault` and through `ObsidianIO`
  with the mock, including "target exists" and "key absent".

## Phase 2 — Planner: the `convert-to-milestone` intent

**Model: Opus 5.** This is where a wrong version still looks right. It runs on the user's only copy of their
strategy notes. A missed inbound link or a link written in the wrong form gives a valid-looking note whose relation
quietly turns into a dangling one, and correctness spans the graph edges, link forms, id allocation and the write
order (C5).
**Escalate/stop if:** links in the real vault are written in a form `removeLinksFromField`/`addLinkToField` don't
compare as equal (path form, alias, heading), so a rewrite would duplicate or miss one. That is a change to how links
are matched, which the user should see before it lands.

- **Current State.** `planIntent` (`src/core/edits.ts:83`) handles status, dates, text, relations, log, kill, falsify
  and creations. Nothing changes a note's type.
- **Desired State.** `{ kind: 'convert-to-milestone'; key: string }` returns a plan with the writes below, a notice,
  and `renamed: { from: 'B-<n>', to: 'M-<n>', path: <new path> }` (on `ActionPlan` and passed through by `performIntent`
  as `EditOutcome.renamed`).
- **Problems.** No intent changes a type; there is no shared "who links to this note, from which field" helper that
  the plan can use for the rewrite.
- **Solutions.**
  1. **Refusals (each one a sentence for the disabled menu item):** not a bet; no `id`; `killed` (C2); has a `next`
     (C1); is the `next` of some bet, named (C1); the target path exists.
     Expose them as `convertProblem(graph, key): string | null` so the menu and the planner share one check.
  2. **Id and path:** allocate as `planMilestone` does (`parseIds` over `MILESTONES_FOLDER`); title = old basename with
     its `B-<n>` prefix and following spaces removed (`B-10  byTalent …` → `M-<n> byTalent …`).
  3. **Writes, in order (C5):**
     - `move` old path → new path;
     - on the new path: `set-field` `type: milestone`, `id: M-<n>`, `status` (C2); `delete-field` for `started`,
       `deadline`, `expected-result`, `ultimately-serves`, `next` (C3); `append-log` `Converted from bet B-<n>.`;
     - for every graph edge into the bet whose holder writes a relation field (`serves`, `requires`, from bets,
       milestones and fixed points): `remove-link` of the old link forms, then `add-link` `[[M-<n> <title>]]`, both
       idempotent (C5).
  4. **Edge parity check (in the tests, the named verification for this phase):** for a conversion over the test
     vault, `buildGraph` before and after must have the same edges with `B-<n>` read as `M-<n>`, minus the dropped
     `ultimately-serves`, and no new issues. A missed inbound link fails this test.
- **Tests.** Unit tests in `tests/graph/` over the test vault (`MemoryVault`): each refusal; status mapping; dropped
  keys and kept unknown keys (B-16-style `categories`); body bytes unchanged apart from the Log line; a bet that
  serves a fixed point and is required by another bet; one required by a fixed point; the double-space basename;
  the edge parity check. `tests/characterization/v2-graph.test.ts`: a converted note builds a clean graph.

## Phase 3 — `.gsmap`: re-key a note id

**Model: Sonnet 5.** It follows the `promote-card` and `rename-file` ops in `gsmap.ts`, and the store tests pin the bytes
it writes.

- **Current State.** `GsOp` has card, frame and link ops, `promote-card` and `rename-file`. Positions and note link
  ends are keyed by id, and `IdTracker` only warns when an id changes.
- **Desired State.** `{ op: 'rename-id'; from: string; to: string }` moves `positions[from]` to `positions[to]` (when `to`
  has none) and re-points every link end `{ note: from }`. Unknown keys survive, as for every op.
- **Problems.** Without it the converted node falls back to auto-layout and its free-card links show as dead links.
- **Solutions.**
  - `gsmap.ts`: the op in `applyOps`, with `firstBadItem` validation untouched.
  - The UI, after `perform` returns `renamed`, calls `mapOp({ op: 'rename-id', from, to })`, as it does for
    `promote-card`. The session then sees the id change as expected, so the "position left behind" notice must not
    fire for it (check `describeIdChange` when the map already holds the new id).
  - Unit tests: position moved, links re-pointed, an existing `to` position kept, unrelated items byte-identical.

## Phase 4 — UI: "Convert to milestone…" on a bet

**Model: Sonnet 5.** The node context menu already builds items with `disabled` reasons
(`StrategyGraph.tsx:840–880`), and the dev page plus Playwright exercise the whole flow over the test vault.

- **Current State.** A bet's right-click menu has "New sequel bet", "New bet serving this", "Add assumption",
  "Kill → activate next", "Open note".
- **Desired State.** A "Convert to milestone…" item on bets, disabled with `convertProblem`'s reason. It opens a
  confirm dialog listing:
  - the new id and path;
  - the status change;
  - the frontmatter keys that will be removed;
  - how many notes get a link re-pointed;
  - the note that links in prose follow only if Obsidian's link updating is on (C6).

  Confirming runs the intent, then the `rename-id` op, and selects the milestone.
- **Problems.** None beyond wiring.
- **Solutions.** The menu item and dialog in `StrategyGraph.tsx` (dialog styled like the existing confirms in
  `src/ui/`). The dev page's `MemoryVault` implements `move`, so the flow runs there. Playwright e2e: convert a bet in
  the migrated test vault. Check that the node changes to the milestone style at the same position, that its edges are
  still drawn, and that the item is disabled with the right reason on a bet with a `next` and on a killed bet.
  `test-vault/ANOMALIES.md` is unchanged: the test vault isn't edited, the e2e runs on the dev page's in-memory copy.

## Phase 5 — Review, docs, and the check in Obsidian

**Model: Sonnet 5.** Documentation, a findings-only code review, and a manual check list for the user.

- `/code-review medium` on the branch, findings triaged by hand (no `--fix`).
- CLAUDE.md (graph view notes, the write list) and the main plan's Change Log get an entry.
- `npm run typecheck && npm test && npm run build && npm run test:e2e` pass.
- **Manual check (user, Obsidian, on `test-vault/` first):**
  - convert a bet with "Automatically update internal links" on, then again with it off: relation links re-pointed
    both times, prose links only with it on;
  - the node keeps its place;
  - the smells panel is sensible (e.g. `requires-open-milestone` now on active bets that require it, which is
    expected).
- Releasing it to Main Vault is a separate step the user asks for.

**Routing:** Phases 1, 3, 4, 5 → Sonnet 5 · Phase 2 → Opus 5

---

## Change Log

## Decisions Log

*(For the user's own hand only.)*
