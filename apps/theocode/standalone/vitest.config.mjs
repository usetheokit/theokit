// Own config so this directory never picks up the parent app's `vitest.config.ts`.
export default { test: { include: ['*.test.mjs'], environment: 'node' } }
