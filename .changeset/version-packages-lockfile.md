---
"@theokit/agents": patch
---

`pnpm version-packages` now refreshes `pnpm-lock.yaml` after `changeset version`, so the release pull request no longer fails `pnpm install --frozen-lockfile` on the bumped `workspace:` pins.
