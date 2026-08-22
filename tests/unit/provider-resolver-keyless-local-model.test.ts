/**
 * A local model must run without a credential for a cloud provider it never contacts
 * (usetheokit/theokit#407).
 *
 * The registry could only describe providers that hold an API key, so `ollama/llama3.2` was an
 * unregistered prefix: it fell through to the priority walk over the three cloud providers and
 * threw a message naming three environment variables, none of which would have helped, pointing
 * the reader at a payment page to buy a key for a model running on their own laptop.
 *
 * The second half is the one the issue does not ask for and which decides the design: a keyless
 * provider MUST NOT participate in the priority fallback. An env key's presence is what tells the
 * walk that a human configured that provider; a keyless entry has no such signal, so including it
 * would route every bare model id to localhost the moment no cloud key was set — replacing a clear
 * "set a key" error with a confusing "Ollama is not reachable".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  listProviders,
  resetProviderAnnouncements,
  resetProviderRegistry,
  resolveProvider,
} from '../../packages/theo/src/server/agent/provider-resolver.js'

const MANAGED = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OLLAMA_HOST',
] as const

describe('provider resolver — a local model needs no cloud credential (#407)', () => {
  beforeEach(() => {
    // stubEnv removes the variable and restores it on unstub — no manual bookkeeping, and no
    // dynamic delete over process.env.
    for (const k of MANAGED) vi.stubEnv(k, undefined)
    resetProviderRegistry()
    resetProviderAnnouncements()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetProviderRegistry()
    resetProviderAnnouncements()
  })

  it('resolves a declared ollama model with no API key set anywhere', () => {
    const resolved = resolveProvider('ollama/llama3.2', { announce: () => undefined })

    expect(resolved.name).toBe('ollama')
    expect(resolved.baseUrl).toBe('http://localhost:11434')
    // Empty rather than a placeholder: the SDK's Ollama client sends an `authorization`
    // header only when the key is non-empty, so a fake value would put a bogus header on
    // every request to the developer's own machine.
    expect(resolved.apiKey).toBe('')
  })

  // Guards the REPORTED endpoint, not the routing: no caller in this framework reads
  // `.baseUrl` — they take `.apiKey` and let the SDK dial. A resolver that reported
  // localhost while the SDK talked to `gpu-box` would be a debugging trap.
  it('reports the OLLAMA_HOST endpoint, so it agrees with where the SDK dials', () => {
    vi.stubEnv('OLLAMA_HOST', 'http://gpu-box.lan:11500')

    expect(resolveProvider('ollama/llama3.2', { announce: () => undefined }).baseUrl).toBe(
      'http://gpu-box.lan:11500',
    )
  })

  it('never picks a keyless provider by env priority — a bare model id still asks for a key', () => {
    // No key set, and `ollama` IS registered. The walk must not silently route this to
    // localhost; the caller asked for no provider, so the actionable answer is still
    // "configure one", not "your laptop refused the connection".
    expect(() => resolveProvider('gpt-4o-mini', { announce: () => undefined })).toThrow(
      /No LLM provider API key found/u,
    )
  })

  it('keeps the keyless entry out of the credential list the error prints', () => {
    let message = ''
    try {
      resolveProvider(undefined, { announce: () => undefined })
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toContain('OPENROUTER_API_KEY')
    // Naming a variable that grants nothing would send the reader to set it and change nothing.
    expect(message).not.toContain('OLLAMA_HOST')
  })

  it('names the unregistered provider instead of sending the reader to a payment page', () => {
    let message = ''
    try {
      resolveProvider('groq/llama-3.1-70b', { announce: () => undefined })
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toContain('groq')
    expect(message).toContain('groq/llama-3.1-70b')
  })

  it('registers ollama as a default, so no application has to add it', () => {
    expect(listProviders().map((p) => p.name)).toContain('ollama')
  })
})
