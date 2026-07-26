import { describe, expect, it } from 'vitest'

import { ConfigurationError as SdkConfigurationError } from '@theokit/sdk/errors'

/**
 * M61 — there is now ONE `ConfigurationError`. Before, the layer defined its own (`extends Error`)
 * while the SDK shipped a separate one (`extends TheokitAgentError`); a `catch (e instanceof
 * ConfigurationError)` caught one throw path and silently missed the other. These tests pin the
 * unification: the class `@theokit/agents` exports IS the SDK's, so `instanceof` holds across the
 * boundary in BOTH directions.
 */
import { ConfigurationError, ModelCapability } from '../../src/index.js'

describe('M61 — a single ConfigurationError across the SDK ↔ Theokit boundary', () => {
  it('the class @theokit/agents exports is identically the SDK class (not a parallel copy)', () => {
    expect(ConfigurationError).toBe(SdkConfigurationError)
  })

  it('an authoring throw from the Theokit layer is instanceof BOTH import paths', () => {
    // `new ModelCapability(123)` validates at the boundary and throws the layer's ConfigurationError.
    let caught: unknown
    try {
      new ModelCapability(123 as never)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConfigurationError) // caught via @theokit/agents
    expect(caught).toBeInstanceOf(SdkConfigurationError) // ...and via @theokit/sdk/errors — same class
    expect(caught).toBeInstanceOf(Error) // still a plain Error (TheokitAgentError extends Error)
  })

  it('an SDK-constructed ConfigurationError is caught by the @theokit/agents type', () => {
    const fromSdk = new SdkConfigurationError('runtime config problem', { code: 'bad_config' })
    expect(fromSdk).toBeInstanceOf(ConfigurationError) // the reverse direction that used to miss
    expect(fromSdk.name).toBe('ConfigurationError')
  })

  it('carries the SDK `{ code }` option (single-arg construction still works too)', () => {
    expect(new ConfigurationError('x').message).toBe('x')
    const withCode = new ConfigurationError('y', { code: 'role_no_name' })
    expect(withCode.code).toBe('role_no_name')
  })
})
