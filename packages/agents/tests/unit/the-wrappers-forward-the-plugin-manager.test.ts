/**
 * B-414 — both wrappers forward the plugin manager of the handle they wrap.
 *
 * `@theokit/acp` installs its permission plugin through `agent.pluginManager()` and fails closed
 * without it. `withGuardrails` and `withStepCeiling` rebuild the handle and kept only the members
 * they name, so an agent with guardrails or a step ceiling could not be served in the server's
 * default `ask` mode. The fix (plan D2) forwards `pluginManager`, bound, the way `generate` already is.
 *
 * The fake reads `this`, as the SDK's LocalAgent does (`pluginManager() { return this.… }`), so a
 * forward that drops the binding returns nothing and fails here, not first in the server.
 */
import { describe, expect, it } from 'vitest'

import { withGuardrails, withStepCeiling } from '../../src/bridge/handle-wrappers.js'
import type { SdkAgentHandle } from '../../src/bridge/sdk-adapter.js'
import type { Guardrail } from '../../src/guardrails/index.js'

class HandleWithPluginManager {
  readonly agentId = 'fake-agent'

  constructor(private readonly manager: object) {}

  pluginManager(): object {
    return this.manager
  }

  send(): Promise<{ wait: () => Promise<{ result?: string }> }> {
    return Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) })
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }
}

/** The wrapped handle as ACP reads it: `pluginManager` is optional. */
type ServedHandle = SdkAgentHandle & { pluginManager?: () => unknown }

function handleWith(manager: object): SdkAgentHandle {
  return new HandleWithPluginManager(manager) as unknown as SdkAgentHandle
}

const allowAll: Guardrail = { name: 'allow-all', checkOutput: () => ({ action: 'allow' }) }

function pluginManagerOf(handle: SdkAgentHandle, wrapper: string): unknown {
  const served = handle as ServedHandle
  expect(typeof served.pluginManager, `${wrapper} dropped pluginManager`).toBe('function')
  return served.pluginManager?.()
}

describe('the wrappers forward the plugin manager', () => {
  it('test_withGuardrails_forwards_the_plugin_manager_bound_to_the_wrapped_handle', () => {
    const manager = { id: 'guardrails-manager' }

    const wrapped = withGuardrails(handleWith(manager), [allowAll])

    expect(pluginManagerOf(wrapped, 'withGuardrails')).toBe(manager)
  })

  it('test_withStepCeiling_forwards_the_plugin_manager_bound_to_the_wrapped_handle', () => {
    const manager = { id: 'ceiling-manager' }

    const wrapped = withStepCeiling(handleWith(manager), 3)

    expect(pluginManagerOf(wrapped, 'withStepCeiling')).toBe(manager)
  })

  it('test_a_handle_without_a_plugin_manager_has_none_after_wrapping', () => {
    const bare: SdkAgentHandle = {
      agentId: 'bare-agent',
      send: () => Promise.resolve({ wait: () => Promise.resolve({}) }),
      dispose: () => Promise.resolve(),
    }

    const wrapped = withGuardrails(withStepCeiling(bare, 3), [allowAll]) as ServedHandle

    expect(wrapped.pluginManager).toBeUndefined()
  })

  it('test_a_handle_with_no_guards_and_no_ceiling_is_returned_as_the_same_object', () => {
    const handle = handleWith({ id: 'untouched-manager' })

    expect(withStepCeiling(handle, undefined)).toBe(handle)
    expect(withGuardrails(handle, undefined)).toBe(handle)
    expect(withGuardrails(handle, [])).toBe(handle)
  })

  it('test_the_plugin_manager_survives_both_wrappers_composed_as_toAgentFactory_composes_them', () => {
    const manager = { id: 'composed-manager' }

    // The order of `toAgentFactory`: the step ceiling inside, the guardrails outside.
    const wrapped = withGuardrails(withStepCeiling(handleWith(manager), 3), [allowAll])

    expect(pluginManagerOf(wrapped, 'withGuardrails over withStepCeiling')).toBe(manager)
  })
})
