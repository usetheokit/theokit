import { describe, expect, it } from 'vitest'

import { customProviderPlugin } from '../../src/auth-entry.js'

describe('customProviderPlugin', () => {
  it('builds a plugin from a CustomProviderConfig', () => {
    const plugin = customProviderPlugin({
      name: 'particle',
      baseUrl: 'https://api.particle.ai/v1//',
      keyEnv: 'PARTICLE_API_KEY',
    })
    expect(plugin).toBeDefined()
    expect(JSON.stringify(plugin)).not.toContain('//"')
  })
})
