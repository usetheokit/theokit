import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every other vitest config in this monorepo caps this — nine of them, with the same
    // expression and the same reason: the default is one fork per core, each booting a full test
    // environment, and a project that does not cede headroom slows every project sharing the run.
    // This file shipped without it, and the cost was measured rather than guessed: adding it to
    // the root `projects` list took `vitest run tests/unit/` from 266/307s to 418/469s — +55% on
    // a suite whose test COUNT did not change — and tipped a 16s test past its 30s timeout.
    maxWorkers: Math.max(2, cpus().length - 4),
    // Named, so `--project theoclaw` selects it and the root runner reports it by name. A sibling's
    // config carries the same note and the reason it gives is measured: copying one without the
    // name produced a project that was in the list and matched no filter.
    name: 'theoclaw',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
