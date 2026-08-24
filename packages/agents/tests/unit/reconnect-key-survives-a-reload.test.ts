/**
 * A run the server still holds must be REACHABLE after a reload (usetheokit/theokit#387).
 *
 * The whole durable-reconnect machinery — sequence ids on every frame, the `RunEventCache`, the
 * `Last-Event-ID` replay, the `x-theokit-run-id` header — is built and reachable, and one link made
 * it unusable in the case with the highest user cost. The reconnect key lived in a private
 * in-memory field, so a reloaded page built a fresh transport with an empty cell and
 * `reconnectToStream` returned `null` before it reached the network. The run was alive, cached,
 * replayable, and unreachable.
 *
 * The medium is the consumer's decision — a client library writing to browser storage nobody asked
 * it to write to has privacy and SSR consequences — so the seam is injected and the default is
 * exactly what it always was.
 */
import { describe, expect, it, vi } from 'vitest'

import { HttpTransport, type RunIdStore } from '../../src/client/http-transport.js'

const RUN_ID = 'run-7f3a'

function fetchStub(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'GET' || url.includes('/runs/')) {
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-theokit-run-id': RUN_ID },
    })
  }) as unknown as typeof fetch
}

/** A store outside the transport — what `sessionStorage` would be, without the browser. */
function sharedStore(): RunIdStore {
  let runId: string | undefined
  return {
    get: () => runId,
    set: (next) => {
      runId = next
    },
  }
}

async function send(transport: HttpTransport): Promise<void> {
  await transport.sendMessages({ messages: [], chatId: 'c1' } as never)
}

describe('the reconnect key survives a reload when the consumer says where it lives (#387)', () => {
  it('a FRESH transport can reconnect to a run an earlier one started', async () => {
    // The reload, modelled honestly: a new transport instance, nothing carried over in memory —
    // only what the consumer chose to persist.
    const store = sharedStore()
    const fetchImpl = fetchStub()

    await send(
      new HttpTransport({ api: '/api/agents/support', fetch: fetchImpl, runIdStore: store }),
    )
    const afterReload = new HttpTransport({
      api: '/api/agents/support',
      fetch: fetchImpl,
      runIdStore: store,
    })

    expect(await afterReload.reconnectToStream({} as never)).not.toBeNull()
  })

  it('asks for the run the server minted, not for a guess', async () => {
    const store = sharedStore()
    const fetchImpl = fetchStub()

    await send(
      new HttpTransport({ api: '/api/agents/support', fetch: fetchImpl, runIdStore: store }),
    )

    expect(store.get()).toBe(RUN_ID)
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
    await new HttpTransport({
      api: '/api/agents/support',
      fetch: fetchImpl,
      runIdStore: store,
    }).reconnectToStream({} as never)
    expect(String(calls.at(-1)?.[0])).toContain(`/runs/${RUN_ID}/stream`)
  })

  it('stores nothing anywhere by default', async () => {
    // The default is the old private field, so a consumer that asked for no persistence gets none —
    // the package writes to no storage it was not handed.
    const fetchImpl = fetchStub()

    await send(new HttpTransport({ api: '/api/agents/support', fetch: fetchImpl }))
    const afterReload = new HttpTransport({ api: '/api/agents/support', fetch: fetchImpl })

    expect(await afterReload.reconnectToStream({} as never)).toBeNull()
  })

  it('still reconnects within one page lifetime with the default store', async () => {
    // The behaviour that already worked must keep working: this is the socket-drop case with the
    // tab still open, and it is why the issue is not High.
    const fetchImpl = fetchStub()
    const transport = new HttpTransport({ api: '/api/agents/support', fetch: fetchImpl })

    await send(transport)

    expect(await transport.reconnectToStream({} as never)).not.toBeNull()
  })
})
