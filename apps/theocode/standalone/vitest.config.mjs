import { defineConfig } from 'vitest/config'

// Own config: without it vitest finds the app's config one level up and its include misses this file.
export default defineConfig({ test: { include: ['auth.test.mjs'], environment: 'node' } })
