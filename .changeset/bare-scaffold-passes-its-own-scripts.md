---
"create-theokit": patch
---

A `--bare` app passes its own `typecheck` and `test`. The transform removed `@theokit/agents`, `@theokit/sdk` and `@theokit/ui` from `package.json` but left `src/server/agents/hooks` and `skills` importing them and kept the chat page test, so a fresh bare app failed `typecheck` with exit 2 and `test` with exit 1. `--bare` now removes the whole `src/server/agents/` tree and `src/shared/agent.ts`, replaces `src/app/page.test.tsx` with a test of the Hello page, and drops the unused `@usetheo/ui` dependency. (#1008)
