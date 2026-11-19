/**
 * NF-1 end-to-end — createSdkAgentStream drives the REAL translateSdkEvent over a
 * mocked @theokit/sdk `Run.stream()` that yields genuine `SDKMessage` shapes
 * (verified against theokit-sdk/packages/sdk/src/types/messages.ts).
 *
 * Closes the H1 residual gap the re-review flagged: every other test mocks
 * createSdkAgentStream wholesale, so the translator↔adapter seam was never
 * exercised against the real message union. This test scripts the exact shapes
 * `Run.stream()` emits and asserts the translated AgentStreamEvent output — so a
 * future SDK shape drift (e.g. content moving off `msg.message.content`) FAILS here
 * instead of silently returning empty responses against a live SDK.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

interface SdkMsg {
  type: string
  [k: string]: unknown
}

const h = vi.hoisted(() => ({
  messages: [] as SdkMsg[],
  /** Called with the SendOptions before the timeline is read, to emit SDK run events. */
  gate: undefined as undefined | Promise<void>,
  handleId: undefined as undefined | string,
  onSend: undefined as undefined | ((opts: { onRunEvent?: (e: unknown) => void }) => void),
}))

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        send: (_m: unknown, opts?: { onRunEvent?: (e: unknown) => void }) => {
          h.onSend?.(opts ?? {})
          return Promise.resolve({
            ...(h.handleId !== undefined ? { id: h.handleId } : {}),
            // theokit#140 — the fake's ONE ordered timeline. Delegates to this same fake's `stream()`
            // rather than restating its script: two hand-written copies of one fixture drift, and a fake
            // whose timeline disagreed with its stream would go green while production broke.
            events: async function* (this: { stream: () => AsyncGenerator }) {
              await h.gate
              for await (const m of this.stream()) yield { kind: 'message', message: m }
            },
            stream: async function* () {
              for (const m of h.messages) yield m
            },
            wait: async () => ({}),
          })
        },
        dispose: () => Promise.resolve(),
      }),
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { recordRefusal, takeRefusal } = await import('../../src/bridge/refusal-ledger.js')
const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
await import('reflect-metadata')

const trAgent = applyCapabilities([]) // `@Agent({name, route})` declared no waist field — name/route are HTTP concerns

async function drain(messages: SdkMsg[]) {
  h.messages = messages
  const compiled = trAgent
  const factory = createSdkAgentStream(compiled, [], 'test-key', { model: 'openai/gpt-4o-mini' })
  const out: { type: string; [k: string]: unknown }[] = []
  for await (const ev of factory('hi', 's1')) out.push(ev)
  return out
}

afterEach(() => {
  h.messages = []
  h.onSend = undefined
  h.handleId = undefined
  h.gate = undefined
})

describe('createSdkAgentStream × real SDKMessage shapes (NF-1 end-to-end)', () => {
  it('test_assistant_answer_text_surfaces — msg.message.content reaches text_delta (was empty pre-NF-1)', async () => {
    const out = await drain([
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
      },
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
    ])
    expect(out.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', content: 'the answer' },
    ])
  })

  it('test_tool_using_turn_emits_tool_result_then_single_done — B1 shape over the real translator', async () => {
    const out = await drain([
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: 'r',
        call_id: 'c1',
        name: 'read',
        status: 'completed',
        result: 'ok',
      },
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done reading' }] },
      },
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
    ])
    const toolResults = out.filter((e) => e.type === 'tool_result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({ callId: 'c1', output: 'ok', isError: false })
    // exactly ONE terminal — the adapter fallback must not double-emit after FINISHED→done
    expect(out.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1)
    expect(out.at(-1)).toMatchObject({ type: 'done' })
  })

  it('test_status_ERROR_surfaces_as_error_terminal — fail-loud, not swallowed', async () => {
    const out = await drain([
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'ERROR', message: 'boom' },
    ])
    const terminals = out.filter((e) => e.type === 'done' || e.type === 'error')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ type: 'error', message: 'boom' })
  })

  it('test_no_terminal_in_stream_gets_fallback_done — B1 guarantee preserved', async () => {
    // Stream with no status message at all → adapter appends exactly one fallback done.
    const out = await drain([
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: 'r',
        call_id: 'c9',
        name: 'x',
        status: 'completed',
        result: 'r',
      },
    ])
    expect(out.filter((e) => e.type === 'done')).toHaveLength(1)
    expect(out.at(-1)).toMatchObject({ type: 'done' })
  })
})

describe('permission_denied → typed refusal on the tool result', () => {
  const toolDone = (id: string, result: unknown) => ({
    type: 'tool_call',
    agent_id: 'a',
    run_id: 'r',
    call_id: id,
    name: 'Bash',
    status: 'completed',
    result,
  })
  const denied = (toolCallId: string, source: string, message: string) => ({
    type: 'permission_denied',
    toolName: 'Bash',
    toolCallId,
    source,
    message,
  })
  const results = (out: { type: string; [k: string]: unknown }[]) =>
    out.filter((e) => e.type === 'tool_result')

  it('a permission_denied run event marks the matching tool result with a refusal', async () => {
    h.onSend = (o) => {
      o.onRunEvent?.(denied('c1', 'plugin', 'not allowed here'))
    }
    const out = await drain([
      toolDone('c1', { stdout: '', stderr: 'denied', exitCode: 126 }),
      toolDone('c2', { stdout: 'ok', stderr: '', exitCode: 0 }),
    ])
    const [r1, r2] = results(out)
    expect(r1).toMatchObject({
      callId: 'c1',
      isError: true,
      refusal: { by: 'plugin', reason: 'not allowed here' },
    })
    expect(r2).not.toHaveProperty('refusal')
  })

  it('a permission_denied from a file hook gives refusal by hook', async () => {
    h.onSend = (o) => {
      o.onRunEvent?.(denied('c1', 'file_hook', 'hook said no'))
    }
    const out = await drain([toolDone('c1', { stdout: '', stderr: 'x', exitCode: 126 })])
    expect(results(out)[0]).toMatchObject({ refusal: { by: 'hook', reason: 'hook said no' } })
  })

  it('a fork_whitelist denial gives refusal by plugin', async () => {
    h.onSend = (o) => {
      o.onRunEvent?.(denied('c1', 'fork_whitelist', 'm'))
    }
    const out = await drain([toolDone('c1', { stdout: '', stderr: 'x', exitCode: 126 })])
    expect(results(out)[0]).toMatchObject({ refusal: { by: 'plugin' } })
  })

  it('a ledger entry for the run and tool replaces the source-derived refusal and is consumed', async () => {
    const msg = recordRefusal('sdk-run-1', 'Bash', { by: 'human', reason: 'no thanks' }, 'denied')
    h.onSend = (o) => {
      o.onRunEvent?.({ ...denied('c1', 'plugin', msg), runId: 'sdk-run-1' })
    }
    const out = await drain([toolDone('c1', { stdout: '', stderr: 'x', exitCode: 126 })])
    expect(results(out)[0]).toMatchObject({ refusal: { by: 'human', reason: 'no thanks' } })
    expect(takeRefusal('sdk-run-1', 'Bash')).toBeUndefined()
  })

  it('a veto from a plugin the framework did not build keeps by plugin', async () => {
    h.onSend = (o) => {
      o.onRunEvent?.({ ...denied('c1', 'plugin', 'external says no'), runId: 'sdk-run-2' })
    }
    const out = await drain([toolDone('c1', { stdout: '', stderr: 'x', exitCode: 126 })])
    expect(results(out)[0]).toMatchObject({ refusal: { by: 'plugin', reason: 'external says no' } })
  })

  it('two same-tool vetoes with IDENTICAL text bind to their own calls, whatever the order', async () => {
    const m1 = recordRefusal('sdk-run-4', 'Bash', { by: 'human', reason: 'first' }, 'same')
    const m2 = recordRefusal('sdk-run-4', 'Bash', { by: 'policy', reason: 'second' }, 'same')
    h.handleId = 'sdk-run-4'
    h.onSend = (o) => {
      // Concurrent dispatch: the SDK reports the second veto's denial first.
      o.onRunEvent?.(denied('c2', 'plugin', m2))
      o.onRunEvent?.(denied('c1', 'plugin', m1))
    }
    const out = await drain([
      toolDone('c2', { stdout: '', stderr: 'x', exitCode: 126 }),
      toolDone('c1', { stdout: '', stderr: 'x', exitCode: 126 }),
    ])
    const byCall = Object.fromEntries(results(out).map((r) => [r.callId, r.refusal]))
    expect(byCall.c1).toMatchObject({ by: 'human', reason: 'first' })
    expect(byCall.c2).toMatchObject({ by: 'policy', reason: 'second' })
  })

  it('interleaved framework and external denials of one tool are each classified by call id', async () => {
    h.handleId = 'sdk-run-5'
    const m1 = recordRefusal('sdk-run-5', 'Bash', { by: 'human', reason: 'person said no' }, 'x')
    const m2 = recordRefusal('sdk-run-5', 'Bash', { by: 'hook', reason: 'hook said no' }, 'x')
    h.onSend = (o) => {
      o.onRunEvent?.(denied('c1', 'plugin', 'external says no'))
      o.onRunEvent?.(denied('c2', 'plugin', m2))
      o.onRunEvent?.(denied('c3', 'plugin', 'external says no'))
      o.onRunEvent?.(denied('c4', 'plugin', m1))
    }
    const out = await drain(
      ['c1', 'c2', 'c3', 'c4'].map((id) =>
        toolDone(id, { stdout: '', stderr: 'x', exitCode: 126 }),
      ),
    )
    const byCall = Object.fromEntries(results(out).map((r) => [r.callId, r.refusal]))
    expect(byCall.c1).toMatchObject({ by: 'plugin', reason: 'external says no' })
    expect(byCall.c2).toMatchObject({ by: 'hook', reason: 'hook said no' })
    expect(byCall.c3).toMatchObject({ by: 'plugin', reason: 'external says no' })
    expect(byCall.c4).toMatchObject({ by: 'human', reason: 'person said no' })
  })

  it('an external denial ending with a copied framework veto does not consume it', async () => {
    h.handleId = 'sdk-run-6'
    const m1 = recordRefusal('sdk-run-6', 'Bash', { by: 'human', reason: 'person said no' }, 'x')
    h.onSend = (o) => {
      o.onRunEvent?.(denied('c1', 'plugin', `external, quoting: ${m1}`))
      o.onRunEvent?.(denied('c2', 'plugin', m1))
    }
    const out = await drain(
      ['c1', 'c2'].map((id) => toolDone(id, { stdout: '', stderr: 'x', exitCode: 126 })),
    )
    const byCall = Object.fromEntries(results(out).map((r) => [r.callId, r.refusal]))
    expect(byCall.c1).toMatchObject({ by: 'plugin' })
    expect(byCall.c2).toMatchObject({ by: 'human', reason: 'person said no' })
  })

  it('a denial reported after the consumer closed the stream does not re-retain the run', async () => {
    h.handleId = 'sdk-run-7'
    let sink: ((e: unknown) => void) | undefined
    h.onSend = (o) => {
      sink = o.onRunEvent
    }
    h.messages = [toolDone('c1', { stdout: 'ok', stderr: '', exitCode: 0 })]
    const factory = createSdkAgentStream(trAgent, [], 'test-key', { model: 'openai/gpt-4o-mini' })
    const it = factory('hi', 's1')[Symbol.asyncIterator]()
    await it.next()
    await it.return(undefined) // consumer cancels; the detached SDK run keeps going
    // The still-running SDK run vetoes twice more; its late denial takes only one of them.
    const m1 = recordRefusal('sdk-run-7', 'Bash', { by: 'human', reason: 'a' }, 'x')
    recordRefusal('sdk-run-7', 'Bash', { by: 'human', reason: 'b' }, 'x')
    sink?.(denied('c2', 'plugin', m1))
    // Unmanaged runs flooding in must be able to evict the leftover entry: it is not retained.
    for (let r = 0; r < 600; r++) recordRefusal(`r-late-${r}`, 'Bash', { by: 'policy' }, 'm')
    expect(takeRefusal('sdk-run-7', 'Bash')).toBeUndefined()
  })

  it('entries a run left unmatched are dropped when it ends', async () => {
    recordRefusal('sdk-run-3', 'Bash', { by: 'policy' }, 'm')
    h.onSend = (o) => {
      o.onRunEvent?.({ ...denied('c9', 'plugin', 'm'), runId: 'sdk-run-3' })
    }
    await drain([toolDone('c1', { stdout: 'ok', stderr: '', exitCode: 0 })])
    expect(takeRefusal('sdk-run-3', 'Bash')).toBeUndefined()
  })

  it('a tool whose shell exits 126 with no permission_denied is a failed result without refusal', async () => {
    const out = await drain([
      toolDone('c1', { stdout: '', stderr: 'cannot execute', exitCode: 126 }),
    ])
    const r = results(out)[0]!
    expect(r.isError).toBe(true)
    expect(r).not.toHaveProperty('refusal')
  })
})
