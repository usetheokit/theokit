---
"@theokit/agents": minor
---

`@theokit/agents/tools` gains scheduled runs. `createJobStore(file)` keeps jobs in one JSON file, written atomically with mode 0600, and refuses a malformed file with `ScheduleStoreError`. `createScheduler({ store, run, deliver })` registers each job as an SDK `Cron` workflow target: each fire runs the prompt with the previous answer's last 4000 characters, stores the answer, and delivers it unless the answer is `[SILENT]`. A failed run delivers one failure line, an overlapping fire is skipped, and `stop()` aborts in-flight runs. `createScheduleTools({ scheduler, platforms })` gives an owner's agent `schedule_job`, `list_scheduled_jobs` and `cancel_scheduled_job`. (B-396)
