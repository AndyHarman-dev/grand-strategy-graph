---
id: A-12
type: assumption
status: unverified
created: 2026-10-01
verify-by: 2026-12-15
---
## The Assumption
Workshops can fill eight seats.

## How I'd Know It's False
Fewer than four sign-ups after two months of ads.

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
