---
'theokit': patch
---

The release guard no longer fails a successful release because npm had not caught up yet.

`npm view` answers E404 for a few seconds after a publish that already succeeded — the registry's read path is eventually consistent. The guard read three seconds after `changeset publish` wrote, and reported five packages as never published when all five were on the registry. It then pointed the reader at a missing credential, for a release with no credential problem at all.

Absent versions are now re-read on a bounded schedule before being called unpublished. A version that genuinely never published still fails, and an unreachable registry still fails immediately rather than waiting out the budget.
