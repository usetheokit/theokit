import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Nine sibling configs in this monorepo compute exactly this expression. That is the whole
    // reason it is here, and it is a weaker reason than the one an earlier version of this comment
    // gave — which a reviewer refuted structurally, twice:
    //
    //   1. `vitest list tests/unit/` selects ZERO specs from this project. The filter is a path
    //      substring and `apps/theoclaw/tests/composition.test.ts` does not contain `tests/unit/`,
    //      so a project with no specs never reaches the code a worker cap would govern.
    //   2. vitest 4's `resolveMaxWorkers` falls back to the ROOT config's `maxWorkers` before the
    //      per-core default, and the root has carried 8 since before this file existed. "The
    //      default is one fork per core" is unreachable in a root-driven run.
    //
    // So: registering this app in the root `projects` list was measured alongside a wall-clock
    // change (265.61/307.19s before, 417.68/469.02s after, 337.79/241.31s with this line). The
    // INTERVAL was observed. The CAUSE was not established, the post-cap spread is 97s against a
    // declared noise floor of 41.6s, and n=2 per condition cannot separate them. This line stays
    // because matching the siblings makes a config mismatch unreachable by construction — not
    // because it is known to have fixed anything.
    maxWorkers: Math.max(2, cpus().length - 4),
    // Named, so `--project theoclaw` selects it and the root runner reports it by name. A sibling's
    // config carries the same note and the reason it gives is measured: copying one without the
    // name produced a project that was in the list and matched no filter.
    name: 'theoclaw',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
