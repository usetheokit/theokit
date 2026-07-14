/**
 * M44 (ADR-0053) — createAgentClient: the standalone (no-React) agent client over the AgentClient store.
 * Drives ANY transport with the same API (send/abort/reset/approve/reconnect/subscribe/getState/stream);
 * `stream(input)` yields progressive assistant snapshots. Plus an import-graph assertion: the React-free
 * `client/core` entry pulls no React.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { createAgentClient } from '../../packages/theo/src/client/create-agent-client.js'
import {
  InProcessTransport,
  type InProcessRunInput,
} from '../../packages/theo/src/client/in-process-transport.js'
import type { AgentTransport, ApprovalDecision } from '../../packages/theo/src/client/transport.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = resolve(HERE, '../../packages/theo/src/client')

function chunkStream(chunks: Array<Record<string, unknown>>): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c as UIMessageChunk)
      controller.close()
    },
  })
}

const TEXT_TURN = [
  { type: 'start' },
  { type: 'text-start', id: 't0' },
  { type: 'text-delta', id: 't0', delta: 'Hello' },
  { type: 'text-end', id: 't0' },
  { type: 'finish' },
]

function fakeTransport(overrides: Partial<AgentTransport> = {}): AgentTransport {
  return {
    sendMessages: (async () => chunkStream(TEXT_TURN)) as ChatTransport<UIMessage>['sendMessages'],
    reconnectToStream: (async () => null) as ChatTransport<UIMessage>['reconnectToStream'],
    ...overrides,
  }
}

describe('createAgentClient (M44)', () => {
  it('test_stream_yields_progressive_assistant_snapshots_and_final_text', async () => {
    const client = createAgentClient(fakeTransport())
    // Count streaming-status emits independently — the yields come ONLY from streaming emits that
    // carried a message (the first send emit is empty; the terminal 'done' emit must add NO yield).
    let streamingEmits = 0
    const unsub = client.subscribe(() => {
      if (client.getState().status === 'streaming') streamingEmits += 1
    })
    const yielded: UIMessage[] = []
    for await (const message of client.stream({ message: 'hi' })) {
      yielded.push(message)
    }
    unsub()

    expect(yielded.length).toBeGreaterThan(0)
    const text = (yielded.at(-1)?.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hello')
    // No duplicate-on-final-emit: the terminal 'done' emit does NOT push the (already-yielded) final
    // message. With the empty first send emit not yielded, yields are strictly fewer than streaming
    // emits. (Before the fix, the 'done' push made them EQUAL — this assertion was RED.)
    expect(yielded.length).toBeLessThan(streamingEmits)
  })

  it('test_stream_rejects_on_a_failed_turn', async () => {
    const transport = fakeTransport({
      sendMessages: (async () => {
        throw new Error('boom 500')
      }) as ChatTransport<UIMessage>['sendMessages'],
    })
    const client = createAgentClient(transport)
    const iterate = async (): Promise<void> => {
      for await (const _ of client.stream({ message: 'hi' })) {
        /* drain */
      }
    }
    await expect(iterate()).rejects.toThrow(/boom 500/)
  })

  it('test_early_break_unsubscribes_and_aborts_the_turn', async () => {
    // A transport whose stream yields a partial message then never closes — a consumer that breaks early
    // must trigger the generator's return() → finally → unsubscribe + abort (the turn's signal aborts).
    let signal: AbortSignal | undefined
    const transport = fakeTransport({
      sendMessages: (async (opts: { abortSignal?: AbortSignal }) => {
        signal = opts.abortSignal
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start' } as UIMessageChunk)
            controller.enqueue({ type: 'text-start', id: 't0' } as UIMessageChunk)
            controller.enqueue({ type: 'text-delta', id: 't0', delta: 'partial' } as UIMessageChunk)
            // never closes — a live turn
          },
        })
      }) as unknown as ChatTransport<UIMessage>['sendMessages'],
    })
    const client = createAgentClient(transport)
    for await (const _ of client.stream({ message: 'hi' })) {
      break // consumer got what it needed
    }
    expect(signal?.aborted).toBe(true)
  })

  it('test_getState_and_subscribe_reflect_status_transitions', async () => {
    const client = createAgentClient(fakeTransport())
    const seen: string[] = []
    const unsub = client.subscribe(() => seen.push(client.getState().status))
    client.send({ message: 'hi' })
    await new Promise<void>((r) => {
      const u = client.subscribe(() => {
        if (client.getState().status !== 'streaming') {
          u()
          r()
        }
      })
    })
    unsub()
    expect(seen).toContain('streaming')
    expect(client.getState().status).toBe('done')
  })

  it('test_getState_thread_accumulates_conversation_across_sends_no_react', async () => {
    // M46 — the React-FREE client surfaces the full conversation `thread` via getState(), so a TUI /
    // vanilla consumer renders history + in-flight WITHOUT hand-rolling a transcript.
    const client = createAgentClient(fakeTransport())
    const settle = () =>
      new Promise<void>((r) => {
        const u = client.subscribe(() => {
          if (client.getState().status === 'done') {
            u()
            r()
          }
        })
      })
    client.send({ message: 'one' })
    await settle()
    client.send({ message: 'two' })
    await settle()
    const roles = client.getState().thread.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('test_approve_routes_to_transport', async () => {
    const approve = vi.fn(async (_id: string, _d: ApprovalDecision) => undefined)
    const client = createAgentClient(fakeTransport({ approve }))
    await client.approve('a1', { approved: true })
    expect(approve).toHaveBeenCalledWith('a1', { approved: true })
  })

  it('test_context_option_reaches_the_transport', async () => {
    let seenContext: unknown
    const run = (input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        seenContext = input.context
        yield { type: 'finish' } as UIMessageChunk
      })()
    const client = createAgentClient(new InProcessTransport({ run }), {
      context: () => ({ metadata: { tenant: 'acme' } }),
    })
    for await (const _ of client.stream({ message: 'hi' })) {
      /* drain */
    }
    expect(seenContext).toEqual({ tenant: 'acme' })
  })

  it('test_client_core_entry_imports_no_react', () => {
    // Recursively resolve the import closure of the React-free entry and assert none imports React.
    const seen = new Set<string>()
    const walk = (file: string): void => {
      const abs = resolve(file)
      if (seen.has(abs)) return
      seen.add(abs)
      const src = readFileSync(abs, 'utf8')
      // Extract every import specifier once (single-quantifier regex — lint-safe), then check in JS.
      const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((mm) => mm[1])
      for (const spec of specifiers) {
        // A React import in the closure defeats the React-free guarantee (ADR-0053 D3) — catch the bare
        // `react` AND any subpath (`react/jsx-runtime`, …), all of which pull React into a bundle.
        expect(spec === 'react' || spec.startsWith('react/')).toBe(false)
        // Recurse into local `.js` imports (ESM convention → resolve to the `.ts` source).
        if (spec.startsWith('.') && spec.endsWith('.js')) {
          walk(resolve(dirname(abs), spec.replace(/\.js$/, '.ts')))
        }
      }
    }
    walk(resolve(CLIENT_DIR, 'core.ts'))
    // Sanity: the closure actually included the store + a transport (not an empty walk).
    expect([...seen].some((f) => f.endsWith('agent-client.ts'))).toBe(true)
    expect([...seen].some((f) => f.endsWith('http-transport.ts'))).toBe(true)
  })
})
