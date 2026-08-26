/**
 * A configuration error reaches the person who can fix it; everything else stays masked (#507).
 *
 * #390 stopped the server's raw text reaching the browser, and that default is right for what it
 * was written against: a driver's message, an HTTP client's, a filesystem call's — text that leaks
 * paths, hostnames and internals to whoever loads the page.
 *
 * `missing_api_key` is not that. It is the operator's own input, and the person reading the blank
 * message IS the person who forgot to set the variable. Masking it costs them the first ten minutes
 * of every misconfiguration and sends them to the network panel — worse, next to `transient: true`,
 * which means "do not persist in history" here and "retry may help" everywhere else a developer has
 * met the word.
 *
 * The hole is deliberately code-driven rather than class-driven. `ConfigurationError` is a large
 * surface and parts of it do describe internals, so an allowlist keyed on the parent would widen by
 * accident the first time something new subclasses it. A list of codes cannot drift silently.
 */
import { describe, expect, it } from 'vitest'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import { presentUIMessageStream } from '../../src/bridge/present-ui-message-stream.js'

/** Must never appear on the wire — the same marker discipline as the #390 suite. */
const SERVER_TEXT = 'INTERNAL-DETAIL-THAT-MUST-NOT-SHIP orders-db unreachable'

/** What the SDK actually puts in an `AuthenticationError` a host has misconfigured. */
const CONFIG_TEXT = 'No API key found. Set OPENAI_API_KEY or pass apiKey.'

async function* events(...list: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const e of list) yield e
}

async function collect(
  source: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string; onError?: (e: { message: string; code?: string }) => string },
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for await (const chunk of presentUIMessageStream(source, opts)) {
    out.push(chunk as unknown as Record<string, unknown>)
  }
  return out
}

const errorTextOf = (chunks: Record<string, unknown>[]): unknown =>
  chunks.find((c) => c.type === 'error')?.errorText

describe('a configuration error is not masked (#507)', () => {
  it('lets missing_api_key through with its own message', async () => {
    const chunks = await collect(
      events({ type: 'error', message: CONFIG_TEXT, code: 'missing_api_key' } as AgentStreamEvent),
      { textId: 't1' },
    )

    expect(errorTextOf(chunks)).toBe(CONFIG_TEXT)
    // The code still travels — masking never removed the discriminator and neither does unmasking.
    expect(JSON.stringify(chunks)).toContain('missing_api_key')
  })

  it('lets malformed_api_key through too — the same class of operator input', async () => {
    const chunks = await collect(
      events({
        type: 'error',
        message: 'The API key provided is malformed.',
        code: 'malformed_api_key',
      } as AgentStreamEvent),
      { textId: 't2' },
    )

    expect(errorTextOf(chunks)).toBe('The API key provided is malformed.')
  })

  it('does NOT widen: an uncoded failure stays masked (#390 unchanged)', async () => {
    const chunks = await collect(
      events({ type: 'error', message: SERVER_TEXT } as AgentStreamEvent),
      {
        textId: 't3',
      },
    )

    expect(errorTextOf(chunks)).toBe('An error occurred.')
    expect(JSON.stringify(chunks)).not.toContain('INTERNAL-DETAIL-THAT-MUST-NOT-SHIP')
  })

  it('does NOT widen: a coded failure outside the list stays masked (#390 unchanged)', async () => {
    // `UPSTREAM_DOWN` carries a code and is still a server internal. Having a code is not the
    // criterion; being the operator's own input is.
    const chunks = await collect(
      events({ type: 'error', message: SERVER_TEXT, code: 'UPSTREAM_DOWN' } as AgentStreamEvent),
      { textId: 't4' },
    )

    expect(errorTextOf(chunks)).toBe('An error occurred.')
    expect(JSON.stringify(chunks)).toContain('UPSTREAM_DOWN')
    expect(JSON.stringify(chunks)).not.toContain('INTERNAL-DETAIL-THAT-MUST-NOT-SHIP')
  })

  it('a host that supplied its own onError still owns every decision', async () => {
    // The allowlist is the DEFAULT's behaviour, not a rule imposed above the hook. A host that
    // masks everything deliberately must keep getting exactly that.
    const chunks = await collect(
      events({ type: 'error', message: CONFIG_TEXT, code: 'missing_api_key' } as AgentStreamEvent),
      { textId: 't5', onError: () => 'redacted by host' },
    )

    expect(errorTextOf(chunks)).toBe('redacted by host')
  })
})
