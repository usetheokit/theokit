---
"theokit": patch
---

Doc comments in the storage, jobs, cron, webhook, cost and security modules no longer cite ADR numbers whose documents are about something else. They carried numbers from an older ADR series that the current `docs/adr/` reused for unrelated decisions, and the comments ship in the published `.d.ts`, so editor tooltips sent readers to the wrong document. Each citation is replaced by the statement it was meant to support. (#1025)
