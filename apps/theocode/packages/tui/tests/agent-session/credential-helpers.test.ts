import { afterEach, describe, expect, it } from 'vitest'

import { credentialSource, recordProjectEnv } from '../../src/agent-session/credential-helpers.js'

const saved = process.env.ANTHROPIC_API_KEY
afterEach(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = saved
  recordProjectEnv(undefined)
})

describe('credentialSource', () => {
  it('names the .env file when the bootstrap loaded the variable from it', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    recordProjectEnv({ file: '/proj/.env', loaded: ['ANTHROPIC_API_KEY'], refused: [] })
    expect(credentialSource()).toContain('ANTHROPIC_API_KEY (/proj/.env)')
  })

  it('says shell when the .env declares it but the shell value won', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    recordProjectEnv({ file: '/proj/.env', loaded: [], refused: [] })
    expect(credentialSource()).toContain('ANTHROPIC_API_KEY (shell)')
  })
})
