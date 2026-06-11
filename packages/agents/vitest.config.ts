import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@theokit/http/runtime/node': resolve(__dirname, '../http-decorators/src/runtime-node.ts'),
      '@theokit/http': resolve(__dirname, '../http-decorators/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
