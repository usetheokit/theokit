---
'theokit': patch
---

A deployed agent whose provider key is missing answers `500` with the JSON `INTERNAL` error naming the variable, instead of letting the error escape the generated entry. On AWS Lambda that escape surfaced as a bare `502 Internal Server Error` with the reason only in CloudWatch (#941).
