import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    // One build for the whole run — see tests/global-setup.ts (removes a real race).
    globalSetup: ['tests/global-setup.ts'],
    include: ['tests/**/*.test.ts', 'examples/**/*.test.ts'],
    environment: 'node',
  },
})
