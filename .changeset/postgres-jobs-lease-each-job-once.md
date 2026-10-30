---
"theokit": patch
---

`PostgresJobBackend.dequeue` leases each job to one worker. It claimed rows with `SELECT ... FOR UPDATE SKIP LOCKED` and marked them in a second statement, and as two autocommit queries the row lock ended before the lease was written, so concurrent workers leased the same job: with 20 workers over 200 jobs, 162 to 178 jobs ran more than once, and each double claim also spent one of the job's attempts. The claim and the lease are now one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING` statement. (#1011)
