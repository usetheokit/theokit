import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedCredential } from '@theocode/agent/auth'

let next: ResolvedCredential | Error

vi.mock('@theocode/agent/auth', async (orig) => ({
  ...(await orig<typeof import('@theocode/agent/auth')>()),
  dotenvNames: () => new Set<string>(),
  resolveCredential: () => {
    if (next instanceof Error) throw next
    return next
  },
}))

import { credentialSource } from '../../src/agent-session/credential-helpers.js'

const base = { apiKey: 'k', provider: 'openai', inferred: false } as const

describe('credentialSource formats the typed origin', () => {
  beforeEach(() => {
    next = new Error('x')
  })

  it('labels an env origin from the shell', () => {
    next = { ...base, kind: 'api', source: { kind: 'env', varName: 'OPENAI_API_KEY' } }
    expect(credentialSource()).toBe('OPENAI_API_KEY (shell)')
  })

  it('keeps a file path that looks like a variable name a file', () => {
    next = { ...base, kind: 'api', source: { kind: 'file', path: 'AUTH' } }
    expect(credentialSource()).toBe('AUTH')
  })

  it('labels an oauth origin and marks an inferred provider', () => {
    next = { ...base, kind: 'oauth', inferred: true, source: { kind: 'oauth', provider: 'openai' } }
    expect(credentialSource()).toBe('oauth (openai) (provider inferred)')
  })

  it('says none when resolution fails', () => {
    expect(credentialSource()).toBe('none')
  })
})
