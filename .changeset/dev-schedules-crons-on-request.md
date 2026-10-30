---
"theokit": minor
---

`theokit dev --crons` schedules the crons declared under `<serverDir>/crons/` and `<agentsDir>/schedules/` in the dev server. Without the flag, `dev` now prints how many crons are declared and that they are not scheduled, instead of saying nothing. Scheduling stays opt-in so a cron with a side effect does not fire on every dev boot. Cron files load once at boot; an edit applies after a restart. (#1017)
