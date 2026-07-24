import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // One build for the whole run — see tests/global-setup.ts (removes a real race).
    globalSetup: ['tests/global-setup.ts'],
    include: ['tests/**/*.test.ts', 'examples/**/*.test.ts'],
    environment: 'node',
  },
})
