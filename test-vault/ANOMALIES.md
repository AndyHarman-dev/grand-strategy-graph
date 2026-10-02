# Test vault: anomaly map

Synthetic, legacy-format (schema v1) strategy vault. Every anomaly found in the real vault survey
(2026-09-30) has at least one note here. Tests and the migration parity gate rely on this table;
update it whenever a note changes.

| Anomaly | Where | Expected migration outcome |
|---|---|---|
| Scalar `serves` (not a list) | B-1, B-6 | normalized to a list |
| Placeholder link `[[...]]` in `serves` | B-7 | reported, never written |
| Malformed `[[FP-]]` (body serves) / `[[A-]]` (body assumptions) | B-7 | reported, never written |
| Self-loop in `serves` | B-5 → B-5 | reported, never written |
| Dangling link to a non-existent note | B-1 → `A-9 Testing new assumption` | reported, never written |
| Phantom target: empty stray root note | B-6 → `FP-2 Profitable pottery business` (root file) | link kept as is, reported (D13); file never touched |
| Phantom target repeated in body `## Serves` | B-6 (fm and body both → phantom FP-2) | both kept as is (D13), no relation written; body section dropped (D12) |
| Body `## Serves` differs from frontmatter | B-3 (fm B-4, body FP-2), B-8 (fm B-4, body FP-2) | body section dropped; body-only links reported as dropped (D12) |
| `next sequel` field (with a space) | B-1 → B-2 | renamed to `next` |
| Bets listed under "Assumptions This Bet Depends On" | B-4 lists B-3, B-5 | `requires` (D7) |
| Assumption only in the reverse list | A-2 lists B-4, B-4 doesn't list A-2 | unioned into B-4 `assumptions` |
| Assumption only in the forward list | B-3 → A-3 (A-3 reverse list empty) | B-3 `assumptions` |
| Bullet-less reverse backlink | A-4 (`[[B-3 …]]`), A-6 (`[[FP-1 …]]`) | parsed like bulleted ones |
| Assumption depended on by a fixed point | A-6 → FP-1 | FP-1 `assumptions` (D7) |
| Orphan assumption (nobody depends on it via fm) | A-7 (only B-8 body) | B-8 `assumptions` |
| Reverse list without the italic placeholder line | A-1 | parsed the same |
| Double-space basename | `B-7  Part-time barista job` | `id: B-7` set explicitly |
| Extra frontmatter key | B-6 `categories` | preserved verbatim |
| Multi-line block scalar | B-4 `expected-result: \|-` | preserved verbatim |
| Datetime `verify-by` / `created` | A-1, A-5 | left as is |
| Bet statuses | active (B-1,3,4,7), asleep (B-2,8), won (B-5), cancelled (B-6) | asleep→dormant, cancelled→killed (D6) |
| Assumption statuses | confirmed (A-1), unverified, falsified (A-3), undeterminable (A-4) | unchanged (D13) |
| `Current Position.md` without `type` | Strategy/ | `type: current-position` added |
| Empty Milestones folder | Strategy/Milestones | — |
| Known non-graph type `strategic-inbox` | `Strategy/Strategic Inbox.md` | left untouched, not a graph node, no issue (D15) |
| Legacy templates | Templates/Bet, Templates/Assumption | rewritten to schema v2 |
| Dataview filtering on `status = "active"` | Templates/Weekly Review | still works after D6 |

## Canvas (`Strategy/The Map.canvas`)

| Element | Expected outcome |
|---|---|
| File node positions (incl. Current Position) | `positions[id]` in `.gsmap` |
| Groups "Visa route", "Studio route" | frames |
| Text cards: "Visa Route" label, "Golden visa path?" ghost, dashed "Route C …", "Needs elaboration" | free cards (style kept) |
| "AND" diamond with B-3, B-5 → AND → B-4 | free card; matches B-4 `requires` B-3, B-5 |
| Edge B-1 → B-2 labelled "On kill" | matches `next` |
| Edge B-7 → B-4 "Serves" (exists only on canvas) | reported as candidate relation |
| Edge B-8 → B-4 "indirectly serves", B-6 → FP-2 "Killed" | reported (labelled edges) |
| Edge "Golden visa path?" → B-2 "Only A-6" | free card link |
| Non-strategy note `lisbon-neighbourhoods-research.md` + its edge | note-reference card + free card link |
| Edges touching a group: B-6 → "Studio route" "On Kill", "Studio route" → B-4 | dropped, listed in the report (D14); the group stays a frame |
