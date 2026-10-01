## Active bets past deadline
```dataview
TABLE deadline, expected-result
FROM "Strategy/Bets"
WHERE status = "active" AND deadline <= date(today)
```
