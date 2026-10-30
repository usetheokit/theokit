---
"create-theokit": patch
---

The scaffold's `types/jobs.d.ts` tells you to create jobs under `src/server/jobs/`, where the scaffold's `serverDir` points, instead of `server/jobs/`, where `theokit build` never looks. (#1010)
