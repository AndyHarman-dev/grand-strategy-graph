---
id: A-8
type: assumption
status: unverified
created: 2026-10-01
verify-by: 2027-02-01
---
## The Assumption
Ceramics fairs accept newcomers.

## How I'd Know It's False
Rejected by three fairs

## Verify By
*If this assumption is load-bearing, set a date in the frontmatter by which I should have evidence either way. This is the anti-postponement discipline: name the information and the deadline.*

## Depended On By
```dataview
LIST
FROM "Strategy"
WHERE contains(assumptions, this.file.link)
SORT file.name ASC
```

## Log
- 2026-10-01: Created
