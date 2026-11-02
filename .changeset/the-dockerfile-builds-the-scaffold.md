---
"theokit": patch
---

The Dockerfile `theokit docker` writes builds and runs a create-theokit scaffold. It ran `npx theo build`, which installed and ran the unrelated npm package `theo` and failed the image build; it now calls `./node_modules/.bin/theokit` for `build` and `start`. The runner stage copies the top-level directory of the configured `serverDir` and `agentsDir` (`src` in the scaffold) instead of a hardcoded `server/`, copies `pnpm-workspace.yaml` for pnpm projects, and sets `HOST=0.0.0.0` so the server answers outside the container. The generated `.dockerignore` sends the agent context in `.theokit/` to the build and keeps local agent state and old build output out. (#1069)
