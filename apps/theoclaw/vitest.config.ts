import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Named, so `--project theoclaw` selects it and the root runner reports it by name. A sibling's
    // config carries the same note and the reason it gives is measured: copying one without the
    // name produced a project that was in the list and matched no filter.
    name: 'theoclaw',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
