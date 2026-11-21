---
'theokit': patch
---

`PostgresJobBackend.dequeue` leases at most `batchSize` jobs again. When the table statistics said it held one row, Postgres planned the claim as a nested loop that ran the `FOR UPDATE SKIP LOCKED` pick once per row, so a dequeue of one could lease every due job and keep the extra ones locked with no worker on them until their lock expired.
