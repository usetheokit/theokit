import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('node:module')
})

describe('loadTypescript without the optional typescript peer', () => {
  it('names typescript and the install command', async () => {
    vi.doMock('node:module', () => ({
      createRequire: () => () => {
        throw Object.assign(new Error("Cannot find module 'typescript'"), {
          code: 'MODULE_NOT_FOUND',
        })
      },
    }))
    const { loadTypescript } = await import('../src/server/scan/load-typescript.js')
    expect(() => loadTypescript()).toThrow(/"typescript".*npm install --save-dev typescript/s)
  })
})
