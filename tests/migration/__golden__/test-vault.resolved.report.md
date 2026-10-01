# Strategy migration report (dry run)

- Vault: `test-vault`
- Generated: 2026-10-01T00:00:00.000Z
- Resolutions: `test-vault.resolutions.yaml`
- Nothing was written to the vault.

**Status:** **Parity gate passed.** No open questions. Ready for Phase 3 (apply).

## Summary

- Legacy edges (oracle): 51 — `fm:serves` 9, `fm:next sequel` 1, `body:serves` 7, `body:assumptions` 10, `body:depended-on-by` 7, `canvas` 17
- Fates: written 36, dropped 6, kept 1, gsmap-link 8
- Strategy notes: 18; files to change: 21
- Questions: 7 (0 open)

## Parity gate

- ✅ Nothing the planner had to refuse (unreadable frontmatter, unknown canvas nodes)
- ✅ Zero unaccounted edges: every oracle edge has a classified fate
- ✅ Every ambiguity has an accepted answer in resolutions.yaml
- ✅ Every edge classified as a relation is present in the planned graph
- ✅ Every relation in the planned graph is backed by an oracle edge or a resolution
- ✅ Prose outside the three sections and unmanaged frontmatter are unchanged
- ✅ Every canvas node has a position, card or frame
- ✅ Every edge kept as a .gsmap link is there, and its ends exist

## Dropped (not written)

| Edge | From | To | Label | Fate | Detail |
|---|---|---|---|---|---|
| `fm:serves` | B-5 Learn Portuguese to B1 | `[[B-5 Learn Portuguese to B1]]` |  | dropped | a self-loop; dropped (resolution) |
| `fm:serves` | B-7  Part-time barista job | `[[...]]` |  | dropped | malformed (placeholder link); dropped (resolution) |
| `body:assumptions:30` | B-1 Get a D7 visa | `[[A-9 Testing new assumption]]` |  | dropped | dangling (resolves to no note); dropped (resolution) |
| `body:serves:18` | B-3 Sell pottery at weekend markets | `[[FP-2 Own a profitable ceramics studio]]` |  | dropped | body-only link; `## Serves` is dropped without merging (D12) |
| `body:serves:17` | B-7  Part-time barista job | `[[FP-]]` |  | dropped | body-only link, malformed (id prefix with no number); `## Serves` is dropped without merging (D12) |
| `body:serves:18` | B-8 Teach pottery workshops | `[[FP-2 Own a profitable ceramics studio]]` |  | dropped | body-only link; `## Serves` is dropped without merging (D12) |

## Kept as is (D13)

| Edge | From | To | Label | Fate | Detail |
|---|---|---|---|---|---|
| `fm:serves` | B-6 Online ceramics course | `[[FP-2 Profitable pottery business]]` |  | kept as is | links to FP-2 Profitable pottery business.md, which is not a strategy note; kept as is (D13) |

## Every legacy edge and its fate

| Edge | From | To | Label | Fate | Detail |
|---|---|---|---|---|---|
| `fm:serves` | B-1 Get a D7 visa | `[[FP-1 Live in Portugal]]` |  | → `serves` | B-1 Get a D7 visa → FP-1 Live in Portugal; kept |
| `fm:next sequel` | B-1 Get a D7 visa | `[[B-2 Apply for a digital nomad visa]]` |  | → `next` | B-1 Get a D7 visa → B-2 Apply for a digital nomad visa; `next sequel` renamed to `next` |
| `fm:serves` | B-2 Apply for a digital nomad visa | `[[FP-1 Live in Portugal]]` |  | → `serves` | B-2 Apply for a digital nomad visa → FP-1 Live in Portugal; kept |
| `fm:serves` | B-3 Sell pottery at weekend markets | `[[B-4 Save 20000 for kiln and lease]]` |  | → `serves` | B-3 Sell pottery at weekend markets → B-4 Save 20000 for kiln and lease; kept |
| `fm:serves` | B-4 Save 20000 for kiln and lease | `[[FP-2 Own a profitable ceramics studio]]` |  | → `serves` | B-4 Save 20000 for kiln and lease → FP-2 Own a profitable ceramics studio; kept |
| `fm:serves` | B-5 Learn Portuguese to B1 | `[[FP-1 Live in Portugal]]` |  | → `serves` | B-5 Learn Portuguese to B1 → FP-1 Live in Portugal; kept |
| `fm:serves` | B-5 Learn Portuguese to B1 | `[[B-5 Learn Portuguese to B1]]` |  | dropped | a self-loop; dropped (resolution) |
| `fm:serves` | B-6 Online ceramics course | `[[FP-2 Profitable pottery business]]` |  | kept as is | links to FP-2 Profitable pottery business.md, which is not a strategy note; kept as is (D13) |
| `fm:serves` | B-7  Part-time barista job | `[[...]]` |  | dropped | malformed (placeholder link); dropped (resolution) |
| `fm:serves` | B-8 Teach pottery workshops | `[[B-4 Save 20000 for kiln and lease]]` |  | → `serves` | B-8 Teach pottery workshops → B-4 Save 20000 for kiln and lease; kept |
| `body:serves:17` | B-1 Get a D7 visa | `[[FP-1 Live in Portugal]]` |  | → `serves` | B-1 Get a D7 visa → FP-1 Live in Portugal; also in frontmatter `serves`; body section dropped |
| `body:assumptions:28` | B-1 Get a D7 visa | `[[A-1 D7 accepts freelance income]]` |  | → `assumptions` | B-1 Get a D7 visa → A-1 D7 accepts freelance income; forward list |
| `body:assumptions:29` | B-1 Get a D7 visa | `[[A-2 Rent in Lisbon stays under 1200]]` |  | → `assumptions` | B-1 Get a D7 visa → A-2 Rent in Lisbon stays under 1200; forward list |
| `body:assumptions:30` | B-1 Get a D7 visa | `[[A-9 Testing new assumption]]` |  | dropped | dangling (resolves to no note); dropped (resolution) |
| `body:serves:18` | B-2 Apply for a digital nomad visa | `[[FP-1 Live in Portugal]]` |  | → `serves` | B-2 Apply for a digital nomad visa → FP-1 Live in Portugal; also in frontmatter `serves`; body section dropped |
| `body:serves:18` | B-3 Sell pottery at weekend markets | `[[FP-2 Own a profitable ceramics studio]]` |  | dropped | body-only link; `## Serves` is dropped without merging (D12) |
| `body:assumptions:29` | B-3 Sell pottery at weekend markets | `[[A-3 Weekend market stalls are available]]` |  | → `assumptions` | B-3 Sell pottery at weekend markets → A-3 Weekend market stalls are available; forward list |
| `body:assumptions:30` | B-3 Sell pottery at weekend markets | `[[A-4 Tourists buy handmade ceramics]]` |  | → `assumptions` | B-3 Sell pottery at weekend markets → A-4 Tourists buy handmade ceramics; forward list |
| `body:serves:21` | B-4 Save 20000 for kiln and lease | `[[FP-2 Own a profitable ceramics studio]]` |  | → `serves` | B-4 Save 20000 for kiln and lease → FP-2 Own a profitable ceramics studio; also in frontmatter `serves`; body section dropped |
| `body:assumptions:32` | B-4 Save 20000 for kiln and lease | `[[B-3 Sell pottery at weekend markets]]` |  | → `requires` | B-4 Save 20000 for kiln and lease → B-3 Sell pottery at weekend markets; bet listed as an assumption → `requires` (D7) |
| `body:assumptions:33` | B-4 Save 20000 for kiln and lease | `[[B-5 Learn Portuguese to B1]]` |  | → `requires` | B-4 Save 20000 for kiln and lease → B-5 Learn Portuguese to B1; bet listed as an assumption → `requires` (D7) |
| `body:serves:19` | B-5 Learn Portuguese to B1 | `[[FP-1 Live in Portugal]]` |  | → `serves` | B-5 Learn Portuguese to B1 → FP-1 Live in Portugal; also in frontmatter `serves`; body section dropped |
| `body:assumptions:30` | B-5 Learn Portuguese to B1 | `[[A-5 I can study one hour a day]]` |  | → `assumptions` | B-5 Learn Portuguese to B1 → A-5 I can study one hour a day; forward list |
| `body:serves:17` | B-7  Part-time barista job | `[[FP-]]` |  | dropped | body-only link, malformed (id prefix with no number); `## Serves` is dropped without merging (D12) |
| `body:assumptions:28` | B-7  Part-time barista job | `[[A-]]` |  | → `assumptions` | B-7  Part-time barista job → A-7 Workshops can fill eight seats; retargeted to [[A-7 Workshops can fill eight seats]] (resolution) |
| `body:serves:18` | B-8 Teach pottery workshops | `[[FP-2 Own a profitable ceramics studio]]` |  | dropped | body-only link; `## Serves` is dropped without merging (D12) |
| `body:assumptions:29` | B-8 Teach pottery workshops | `[[A-7 Workshops can fill eight seats]]` |  | → `assumptions` | B-8 Teach pottery workshops → A-7 Workshops can fill eight seats; forward list |
| `body:depended-on-by:17` | A-1 D7 accepts freelance income | `[[B-1 Get a D7 visa]]` |  | → `assumptions` | B-1 Get a D7 visa → A-1 D7 accepts freelance income; reverse list |
| `body:depended-on-by:18` | A-2 Rent in Lisbon stays under 1200 | `[[B-1 Get a D7 visa]]` |  | → `assumptions` | B-1 Get a D7 visa → A-2 Rent in Lisbon stays under 1200; reverse list |
| `body:depended-on-by:19` | A-2 Rent in Lisbon stays under 1200 | `[[B-4 Save 20000 for kiln and lease]]` |  | → `assumptions` | B-4 Save 20000 for kiln and lease → A-2 Rent in Lisbon stays under 1200; reverse list |
| `body:depended-on-by:18` | A-4 Tourists buy handmade ceramics | `[[B-3 Sell pottery at weekend markets]]` |  | → `assumptions` | B-3 Sell pottery at weekend markets → A-4 Tourists buy handmade ceramics; reverse list |
| `body:depended-on-by:18` | A-5 I can study one hour a day | `[[B-5 Learn Portuguese to B1]]` |  | → `assumptions` | B-5 Learn Portuguese to B1 → A-5 I can study one hour a day; reverse list |
| `body:depended-on-by:18` | A-6 Portugal stays open to non-EU residents | `[[FP-1 Live in Portugal]]` |  | → `assumptions` | FP-1 Live in Portugal → A-6 Portugal stays open to non-EU residents; reverse list; a fixed-point carries `assumptions` (D7) |
| `body:depended-on-by:18` | A-7 Workshops can fill eight seats | `[[B-8 Teach pottery workshops]]` |  | → `assumptions` | B-8 Teach pottery workshops → A-7 Workshops can fill eight seats; reverse list |
| `canvas e5` | B-3 Sell pottery at weekend markets | `card:t-and` |  | .gsmap link | e5: touches a card: free card link (D8) |
| `canvas e6` | B-5 Learn Portuguese to B1 | `card:t-and` |  | .gsmap link | e6: touches a card: free card link (D8) |
| `canvas e7` | card:t-and | `B-4 Save 20000 for kiln and lease` |  | .gsmap link | e7: touches a card: free card link (D8) |
| `canvas e10` | card:t-ghost | `B-2 Apply for a digital nomad visa` | Only A-6 | .gsmap link | e10: touches a card: free card link (D8) |
| `canvas e11` | lisbon-neighbourhoods-research | `B-1 Get a D7 visa` | Non significant relationship | .gsmap link | e11: touches a card: free card link (D8) |
| `canvas e17` | card:t-routec | `FP-1 Live in Portugal` |  | .gsmap link | e17: touches a card: free card link (D8) |
| `canvas e2` | B-1 Get a D7 visa | `B-2 Apply for a digital nomad visa` | On kill | → `next` | B-1 Get a D7 visa → B-2 Apply for a digital nomad visa; canvas "On kill" matches `next` |
| `canvas e1` | B-1 Get a D7 visa | `FP-1 Live in Portugal` |  | → `serves` | B-1 Get a D7 visa → FP-1 Live in Portugal; canvas edge matches `serves` |
| `canvas e3` | A-1 D7 accepts freelance income | `B-1 Get a D7 visa` |  | → `assumptions` | B-1 Get a D7 visa → A-1 D7 accepts freelance income; canvas edge matches `assumptions` |
| `canvas e4` | A-2 Rent in Lisbon stays under 1200 | `B-1 Get a D7 visa` |  | → `assumptions` | B-1 Get a D7 visa → A-2 Rent in Lisbon stays under 1200; canvas edge matches `assumptions` |
| `canvas e8` | B-8 Teach pottery workshops | `B-4 Save 20000 for kiln and lease` | indirectly serves | → `serves` | B-8 Teach pottery workshops → B-4 Save 20000 for kiln and lease; canvas edge "indirectly serves" matches `serves` |
| `canvas e9` | A-6 Portugal stays open to non-EU residents | `FP-1 Live in Portugal` |  | → `assumptions` | FP-1 Live in Portugal → A-6 Portugal stays open to non-EU residents; canvas edge matches `assumptions` |
| `canvas e12` | B-6 Online ceramics course | `FP-2 Own a profitable ceramics studio` | Killed | .gsmap link | e12: kept as a note↔note annotation in the .gsmap (resolution) |
| `canvas e13` | B-7  Part-time barista job | `B-4 Save 20000 for kiln and lease` | Serves | → `serves` | B-7  Part-time barista job → B-4 Save 20000 for kiln and lease; added from the canvas (resolution) |
| `canvas e14` | B-4 Save 20000 for kiln and lease | `FP-2 Own a profitable ceramics studio` |  | → `serves` | B-4 Save 20000 for kiln and lease → FP-2 Own a profitable ceramics studio; canvas edge matches `serves` |
| `canvas e15` | B-2 Apply for a digital nomad visa | `FP-1 Live in Portugal` |  | → `serves` | B-2 Apply for a digital nomad visa → FP-1 Live in Portugal; canvas edge matches `serves` |
| `canvas e16` | Current Position | `B-1 Get a D7 visa` |  | .gsmap link | e16: kept as a note↔note annotation in the .gsmap (resolution) |

## Canvas → Strategy.gsmap

- Positions: 18 (CP, B-1, B-2, B-3, B-4, B-5, B-6, B-7, B-8, A-1, A-2, A-3, A-4, A-5, A-6, A-7, FP-1, FP-2)
- Cards: 6
  - note (note-ref): lisbon-neighbourhoods-research.md
  - t-route (text): "Visa Route"
  - t-ghost (text): "Golden visa path?" `{"textAlign":"center"}`
  - t-routec (text): "Route C - Freelance visa (suspended)" `{"border":"dashed"}`
  - t-and (text): "AND" `{"shape":"diamond","textAlign":"center"}`
  - t-elab (text): "Needs elaboration"
- Frames: 2
  - g-visa: "Visa route"
  - g-studio: "Studio route"
- Links: 8
  - e5: B-3 → card t-and
  - e6: B-5 → card t-and
  - e7: card t-and → B-4
  - e10: card t-ghost → B-2 "Only A-6"
  - e11: card note → B-1 "Non significant relationship"
  - e17: card t-routec → FP-1
  - e12: B-6 → FP-2 "Killed"
  - e16: CP → B-1

## Files to change

- `Strategy/Assumptions/A-1 D7 accepts freelance income.md`
  - id: A-1
  - `## Depended On By` → Dataview block
- `Strategy/Assumptions/A-2 Rent in Lisbon stays under 1200.md`
  - id: A-2
  - `## Depended On By` → Dataview block
- `Strategy/Assumptions/A-3 Weekend market stalls are available.md`
  - id: A-3
  - `## Depended On By` → Dataview block
- `Strategy/Assumptions/A-4 Tourists buy handmade ceramics.md`
  - id: A-4
  - `## Depended On By` → Dataview block
- `Strategy/Assumptions/A-5 I can study one hour a day.md`
  - id: A-5
  - `## Depended On By` → Dataview block
- `Strategy/Assumptions/A-6 Portugal stays open to non-EU residents.md`
  - id: A-6
  - `## Depended On By` → Dataview block
- `Strategy/Assumptions/A-7 Workshops can fill eight seats.md`
  - id: A-7
  - `## Depended On By` → Dataview block
- `Strategy/Bets/B-1 Get a D7 visa.md`
  - id: B-1
  - serves: scalar → list
  - `next sequel` → `next`
  - assumptions: + [[A-1 D7 accepts freelance income]]
  - assumptions: + [[A-2 Rent in Lisbon stays under 1200]]
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-2 Apply for a digital nomad visa.md`
  - id: B-2
  - status: asleep → dormant
  - `next sequel` → `next`
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-3 Sell pottery at weekend markets.md`
  - id: B-3
  - `next sequel` → `next`
  - assumptions: + [[A-3 Weekend market stalls are available]]
  - assumptions: + [[A-4 Tourists buy handmade ceramics]]
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-4 Save 20000 for kiln and lease.md`
  - id: B-4
  - requires: + [[B-3 Sell pottery at weekend markets]]
  - requires: + [[B-5 Learn Portuguese to B1]]
  - `next sequel` → `next`
  - assumptions: + [[A-2 Rent in Lisbon stays under 1200]]
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-5 Learn Portuguese to B1.md`
  - id: B-5
  - serves: − [[B-5 Learn Portuguese to B1]]
  - `next sequel` → `next`
  - assumptions: + [[A-5 I can study one hour a day]]
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-6 Online ceramics course.md`
  - id: B-6
  - status: cancelled → killed
  - serves: scalar → list
  - `next sequel` → `next`
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-7  Part-time barista job.md`
  - id: B-7
  - serves: − [[...]]
  - serves: + [[B-4 Save 20000 for kiln and lease]]
  - `next sequel` → `next`
  - assumptions: + [[A-7 Workshops can fill eight seats]]
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Bets/B-8 Teach pottery workshops.md`
  - id: B-8
  - status: asleep → dormant
  - `next sequel` → `next`
  - assumptions: + [[A-7 Workshops can fill eight seats]]
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Current Position.md`
  - id: CP
  - type: current-position
- `Strategy/Fixed Points/FP-1 Live in Portugal.md`
  - id: FP-1
  - assumptions: + [[A-6 Portugal stays open to non-EU residents]]
- `Strategy/Fixed Points/FP-2 Own a profitable ceramics studio.md`
  - id: FP-2
- `Templates/Assumption Template.md`
  - add empty `id`
  - `## Depended On By` → Dataview block
- `Templates/Bet Template.md`
  - add empty `id`
  - `next sequel` → `next`
  - add empty `requires`
  - add empty `assumptions`
  - `## Serves` removed
  - `## Assumptions This Bet Depends On` removed
- `Strategy/Strategy.gsmap` (new)
  - 18 positions, 6 cards, 2 frames, 8 links

## Planned graph issues (Phase 1 `buildGraph` over the planned vault)

- warning `non-strategy-target` `Strategy/Bets/B-6 Online ceramics course.md` `serves`: `serves` links to [[FP-2 Profitable pottery business]] (FP-2 Profitable pottery business.md), which is not a strategy note.

## Other findings

- info: `Strategy/The Map.canvas`: "AND" card t-and matches `requires`: B-4 Save 20000 for kiln and lease requires B-3 Sell pottery at weekend markets; B-4 Save 20000 for kiln and lease requires B-5 Learn Portuguese to B1.
