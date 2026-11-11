import { describe, expect, it } from 'vitest'

import { customProviderPlugins, parseCustomProviders } from '../src/agent/custom-providers.js'
import { agentOptionsFor } from '../src/control-plane/agent-factory.js'
import { requireModel } from '../src/control-plane/settings.js'

const PARTICLE = JSON.stringify([{ name: 'particle', baseUrl: 'https://api.particle.ai/v1/', keyEnv: 'PARTICLE_API_KEY' }])

describe('THEOCLAW_PROVIDERS', () => {
  it('is empty when unset', () => {
    expect(parseCustomProviders({})).toEqual([])
  })

  it('parses entries and refuses malformed ones', () => {
    expect(parseCustomProviders({ THEOCLAW_PROVIDERS: PARTICLE })).toHaveLength(1)
    for (const bad of ['nope', '{}', '[{"name":"X","baseUrl":"https://a","keyEnv":"K"}]', '[{"name":"a","baseUrl":"ftp://a","keyEnv":"K"}]', '[{"name":"a","baseUrl":"https://a","keyEnv":"1 2"}]']) {
      expect(() => parseCustomProviders({ THEOCLAW_PROVIDERS: bad })).toThrow(/THEOCLAW_PROVIDERS/)
    }
  })

  it('makes one SDK plugin per provider', () => {
    expect(customProviderPlugins(parseCustomProviders({ THEOCLAW_PROVIDERS: PARTICLE }))).toHaveLength(1)
  })

  it('runs a particle/ model on the provider key and puts the plugin on the agent', () => {
    const env = { THEOCLAW_MODEL: 'particle/particle-1', THEOCLAW_PROVIDERS: PARTICLE, PARTICLE_API_KEY: 'pk' }
    expect(requireModel(env)).toEqual({ model: 'particle/particle-1', modelKey: 'pk' })
    const options = agentOptionsFor(env)
    expect(options.apiKey).toBe('pk')
    expect(options.plugins).toHaveLength(1)
    expect(() => requireModel({ ...env, PARTICLE_API_KEY: '' })).toThrow(/PARTICLE_API_KEY/)
  })
})
