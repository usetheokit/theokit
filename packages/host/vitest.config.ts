import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Named, so `--project host` selects it and the root runner reports it by name.
    name: 'host',
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
