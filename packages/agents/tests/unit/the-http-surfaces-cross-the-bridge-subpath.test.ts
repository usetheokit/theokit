/**
 * B-373 T1.3: the OpenAI-compatible routes and the tool route cross `@theokit/agents/bridge`.
 *
 * TheoClaw imports them by the package name, which resolves `dist/bridge.js` through
 * `package.json#exports`, so a green unit suite over `../../src/...` proves nothing about what a
 * consumer gets. The second test reads the built subpath: build first
 * (`pnpm --filter @theokit/agents build`).
 */
import { describe, expect, it } from 'vitest'

import * as bridgeSource from '../../src/bridge/index.js'

const NAMES = [
  'createOpenAICompatibleRoutes',
  'renderTranscript',
  'createToolInvokeRoute',
  'readCappedBody',
  'BodyTooLargeError',
] as const

describe('the HTTP surfaces cross the ./bridge subpath', () => {
  it('test_the_bridge_barrel_exports_the_new_handlers', () => {
    for (const name of NAMES)
      expect(typeof (bridgeSource as Record<string, unknown>)[name], name).toBe('function')
  })

  it('test_the_built_bridge_subpath_exports_the_new_handlers', async () => {
    const built = (await import('@theokit/agents/bridge')) as Record<string, unknown>

    for (const name of NAMES) expect(typeof built[name], name).toBe('function')
  })
})
