---
"theokit": patch
---

Fix the coordinated-release frozen-lockfile catch-22 (#64): `packages/theo` now consumes `@theokit/agents` and `@theokit/http` via `workspace:^` instead of published-version ranges. pnpm resolves the local package in dev (the lockfile no longer churns on a same-release version bump) and converts `workspace:^` to the identical `^X.Y.Z` range at publish time — the published manifest is byte-identical, so no consumer-visible change. Matches the existing `@theokit/agents → @theokit/http = workspace:*` pattern.
