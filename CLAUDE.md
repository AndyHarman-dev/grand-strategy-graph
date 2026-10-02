# grand-strategy-graph

Obsidian plugin `strategy-bet-creator`: creates Grand Strategy bets and assumptions, and (from Phase 5)
renders the strategy as a data-driven graph. The full plan, decisions (D1–D13) and phase list live in
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
  user-run, local, on the real vault, with Obsidian closed. Tests apply only to throwaway copies of `test-vault/`
  in the OS temp dir. A legacy edge the classification rules don't cover comes out `unclassified` (exit code 2):
  that is a decision for the user (plan Phase 2, "Escalate/stop"), never something to settle in code. Apply stops
  if any touched file's hash differs from the reviewed dry run; never loosen that guard.
- **The legacy plugin oracle is gone.** Phase 4 intentionally changed the notes the plugin writes (schema v2), so
  `tests/legacy/main.js` and its `legacy` test entries were removed; the goldens now pin the v2 output alone.
  Write-side behavior is tied to `buildGraph` by `tests/characterization/v2-graph.test.ts`: every note the plugin
  creates must build a clean graph. Existing notes are only ever changed by appending a link to a frontmatter list
  (`processFrontMatter`), never in the body.

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure TS: helpers, content builders, `actions.ts` (creation intents → planned writes), schema, graph, smells, `.gsmap` format |
| `src/obsidian/` | Obsidian adapter: modals, create flows (execute the planned writes), views, commands |
| `src/ui/` | React components (from Phase 5a) |
| `src/main.ts` | Plugin entry |
| `tools/` | Node-only code: `fs-adapter.ts` (reads a vault folder), `migrate.ts` + `migrate/` (Phase 2 planner, parity gate, report; Phase 3 `apply.ts`) |
| `tests/` | Vitest. `mocks/obsidian.ts` replaces the `obsidian` module; `support/` has the in-memory vault |
| `test-vault/` | Synthetic legacy-format vault; `ANOMALIES.md` maps each note to the anomaly it covers |

## Commands

```sh
npm ci              # install
npm test            # vitest run
npm run typecheck   # tsc --noEmit (TypeScript 7)
npm run build       # esbuild -> dist/main.js + manifest.json + styles.css
npm run dev         # esbuild watch
npm run migrate -- --vault <path> [--resolutions <file>] [--out <dir>]   # migration dry run (outputs outside the vault)
npm run migrate -- --vault <path> --resolutions <file> --apply            # Phase 3, user-run only (backs up to ~/strategy-backups)
```

Run `npm run typecheck && npm test && npm run build` before every push.

## Test vault

- `test-vault/.obsidian/plugins/strategy-bet-creator` is a committed symlink to `../../../dist`, so
  opening `test-vault/` in Obsidian runs the latest build.
- Every note there exists to exercise an anomaly. Update `test-vault/ANOMALIES.md` whenever a note
  changes, and don't "fix" anomalies: they are the test data.
- Tests read it through `tests/support/fake-app.ts` (`readTestVault()`), never by writing to it.

## Releases (BRAT)

The real vault only runs tagged releases. To release: bump `version` in both `manifest.json` and
`package.json`, commit, then push a tag equal to that version (no `v` prefix). `release.yml` checks the
versions match, runs the checks, and attaches `main.js`, `manifest.json` and `styles.css` to a GitHub
Release.

## Gotchas

- `obsidian.d.ts` types `moment` as a non-callable namespace under TS 7; use `today()` from
  `src/obsidian/today.ts` instead of calling `moment` directly.
- The esbuild options live in `esbuild.options.mjs` and are shared with
  `tests/characterization/bundle.test.ts`, which builds and loads the real bundle. Change them there.
