import { describe, expect, it } from 'vitest'

import { createAgentRouter } from '../src/routing/routing-env.js'

const agents = [
  { id: 'main', workspace: '/w/main' },
  { id: 'work', workspace: '/w/work' },
  { id: 'acct', workspace: '/w/acct' },
  { id: 'vip', workspace: '/w/vip' },
]

describe('routing through the real gateway bindings', () => {
  const router = createAgentRouter({
    defaultAgent: 'main',
    agents,
    routes: [
      { agent: 'work', platform: 'slack' },
      { agent: 'acct', platform: 'slack', account: 'bot-2' },
      { agent: 'vip', platform: 'slack', peer: 'bob' },
    ],
  })

  it('prefers peer over account over platform, and falls back to the default', () => {
    expect(router.route({ platform: 'slack', account: 'bot-2', peer: 'bob' }).id).toBe('vip')
    expect(router.route({ platform: 'slack', account: 'bot-2', peer: 'eve' }).id).toBe('acct')
    expect(router.route({ platform: 'slack', account: 'bot-1', peer: 'eve' }).id).toBe('work')
    expect(router.route({ platform: 'telegram', peer: 'bob' }).id).toBe('main')
  })
})
