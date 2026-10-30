---
"theokit": minor
---

`theokit start` and `theokit dev` run the jobs declared under `<serverDir>/jobs/`. A job worker starts in the same process when jobs are declared and `jobs.backend` is set: it polls the backend, runs each job, and backs off while the backend is unreachable. On `SIGTERM`, `start` stops polling and waits up to 20 seconds for the job in progress before closing storage. The new `jobs.worker` config block tunes it (`pollIntervalMs`, `batchSize`, `lockSeconds`) and `enabled: false` turns it off, for a process that should only serve requests. The boot log says what happens to the declared jobs, including when no backend is set. `createJobWorker` is exported from `theokit/server/jobs` for a worker process of your own. Until now nothing on the serving side read `.theokit/jobs.json`, so enqueued jobs were never run. (#1010)
