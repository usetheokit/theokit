import { describe, expect, it } from 'vitest'

import * as publicApi from '../../src/index.js'

/**
 * Locks the pieces of the package's public barrel that are easy to drop by accident during an
 * internal refactor. M56 removed a compat re-export of `ConfigurationError` from
 * `capability/capabilities.ts` and, with it, silently dropped the class from the package API — the
 * barrel re-exported `capabilities.js`, so the error type reached consumers through it. Consumers
 * `catch (e) { if (e instanceof ConfigurationError) … }`, so this is contract, not internal detail.
 */
describe('public API surface', () => {
  it('exports ConfigurationError (consumers catch it)', () => {
    expect(publicApi.ConfigurationError).toBeTypeOf('function')
    // It must be the real class — a value that survives `instanceof` across the boundary.
    const err = new publicApi.ConfigurationError('x')
    expect(err).toBeInstanceOf(publicApi.ConfigurationError)
    expect(err.name).toBe('ConfigurationError')
  })

  it('exports the capability authoring surface', () => {
    for (const name of ['applyCapabilities', 'ToolboxCapability', 'ModelCapability'] as const) {
      expect(publicApi[name], name).toBeTypeOf('function')
    }
  })
})
