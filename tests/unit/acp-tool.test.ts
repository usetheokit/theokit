/**
 * M17 (theokit-ai-first) — createACPTool: wrap a coding agent (Claude Code, Amp, Codex) as a tool.
 *
 * `createACPTool` spawns the agent via a transport (Node subprocess by default; injectable for
 * tests), drives it with `AcpClient`, and returns a `CustomTool`. `onPermissionRequest` is REQUIRED
 * (security by default — no default-allow). The real subprocess transport is smoke-tested against a
 * node echo agent.
 *
 * TDD RED-first.
 */
import type { AcpTransport } from '../../packages/agents/src/acp/client.js'
import { encodeAcpMessage, AcpMessageDecoder } from '../../packages/agents/src/acp/protocol.js'
import { describe, expect, it, vi } from 'vitest'

import {
  AcpRequestTimeoutError,
  AcpTransportClosedError,
  createACPTool,
  NodeAcpTransport,
} from '../../packages/theo/src/server/agent/acp-tool.js'

/** ACP v1 params of the permission request the scripted agent sends mid-prompt. */
const PERMISSION_PARAMS = {
  sessionId: 's1',
  toolCall: { toolCallId: 't1', title: 'rm', kind: 'delete', status: 'pending' },
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
  ],
}

/**
 * A fake ACP agent: answers `initialize` and `session/new`, and answers `session/prompt` the way
 * ACP does, with the text as a `session/update` `agent_message_chunk` and only `stopReason` in the
 * result. With `askPermission`, it first sends `session/request_permission` (id 7), records the
 * client's response in `permissionReplies`, and only then finishes the turn.
 */
function scriptedTransport(
  options: {
    onSend?: (msg: Record<string, unknown>) => void
    askPermission?: boolean
    permissionReplies?: Record<string, unknown>[]
    /** Answer this method with a JSON-RPC error, the way an agent refuses a step. */
    refuse?: string
    /** Never answer this method, the way a stuck agent behaves. */
    silentOn?: string
  } = {},
): AcpTransport {
  const dec = new AcpMessageDecoder()
  let sink: ((chunk: string) => void) | undefined
  let finishTurn: (() => void) | undefined
  const reply = (message: Record<string, unknown>) =>
    sink?.(encodeAcpMessage({ jsonrpc: '2.0', ...message }))
  const onPrompt = (msg: Record<string, unknown>) => {
    const p = msg.params as { sessionId: string; prompt: { text: string }[] }
    finishTurn = () => {
      reply({
        method: 'session/update',
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `echo:${p.prompt.map((b) => b.text).join('')}` },
          },
        },
      })
      reply({ id: msg.id, result: { stopReason: 'end_turn' } })
    }
    if (options.askPermission) {
      reply({ id: 7, method: 'session/request_permission', params: PERMISSION_PARAMS })
    } else {
      finishTurn()
    }
  }
  /** The methods the agent answers by name; anything else is a response or ignored. */
  const answers = new Map<string, (msg: Record<string, unknown>) => void>([
    ['initialize', (msg) => reply({ id: msg.id, result: { protocolVersion: 1 } })],
    ['session/new', (msg) => reply({ id: msg.id, result: { sessionId: 's1' } })],
    ['session/prompt', onPrompt],
  ])
  /** Whether `msg` calls the method an option names; an unset option names nothing. */
  const calls = (msg: Record<string, unknown>, method: string | undefined) =>
    method !== undefined && msg.method === method
  const respond = (msg: Record<string, unknown>) => {
    if (calls(msg, options.refuse)) {
      reply({ id: msg.id, error: { code: -32602, message: 'invalid params' } })
      return
    }
    // A silent method gets no answer: the request stays pending on the agent side forever.
    if (calls(msg, options.silentOn)) return
    const answer = typeof msg.method === 'string' ? answers.get(msg.method) : undefined
    if (answer !== undefined) answer(msg)
    else if (msg.id === 7 && msg.method === undefined) {
      options.permissionReplies?.push(msg)
      finishTurn?.()
    }
  }
  return {
    send: (line) => {
      for (const m of dec.push(line)) {
        const msg = m as Record<string, unknown>
        options.onSend?.(msg)
        respond(msg)
      }
    },
    subscribe: (cb) => {
      sink = cb
    },
  }
}

describe('createACPTool', () => {
  it('returns a CustomTool that prompts the coding agent and returns its text', async () => {
    const tool = createACPTool({
      command: 'noop',
      name: 'code_agent',
      description: 'A coding agent',
      onPermissionRequest: () => ({ granted: true }),
      transportFactory: () => scriptedTransport(),
    })
    expect(tool.name).toBe('code_agent')
    const out = await tool.handler({ message: 'write a test' })
    expect(out).toBe('echo:write a test')
  })

  it('requires onPermissionRequest (security by default — no default-allow)', () => {
    expect(() =>
      // @ts-expect-error — omitting onPermissionRequest is a compile + runtime error
      createACPTool({
        command: 'noop',
        name: 'x',
        description: 'd',
        transportFactory: () => scriptedTransport(),
      }),
    ).toThrow(/onPermissionRequest/)
  })

  it('routes a permission request from the agent to onPermissionRequest', async () => {
    const onPermissionRequest = vi.fn(() => ({ granted: false }))
    const sent: unknown[] = []
    const permissionReplies: Record<string, unknown>[] = []
    const tool = createACPTool({
      command: 'noop',
      name: 'code_agent',
      description: 'd',
      onPermissionRequest,
      transportFactory: () =>
        scriptedTransport({
          askPermission: true,
          permissionReplies,
          onSend: (msg) => {
            if (typeof msg.method === 'string') sent.push(msg.method)
          },
        }),
    })

    const output = await tool.handler({ message: 'hi' })

    expect(onPermissionRequest).toHaveBeenCalledWith(PERMISSION_PARAMS)
    expect(permissionReplies).toHaveLength(1)
    expect(permissionReplies[0].error).toBeUndefined()
    expect(permissionReplies[0].result).toEqual({
      outcome: { outcome: 'selected', optionId: 'deny' },
    })
    expect(sent).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(output).toBe('echo:hi')
  })
})

describe('NodeAcpTransport (real subprocess smoke)', () => {
  it('round-trips a JSON-RPC message through a node echo agent', async () => {
    const echo = [
      "process.stdin.on('data',b=>{",
      "for(const l of b.toString().split('\\n')){",
      'if(!l.trim())continue;const m=JSON.parse(l);',
      "if(m.method==='session/prompt')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{text:'ok:'+m.params.message}})+'\\n');",
      '}})',
    ].join('')
    const transport = new NodeAcpTransport('node', ['-e', echo])
    const received: string[] = []
    transport.subscribe((c) => {
      received.push(c)
    })
    transport.send(
      encodeAcpMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        params: { message: 'hey' },
      }),
    )
    // Wait for the ANSWER, not for a clock. A fixed `setTimeout(300)` here was a real flake: it
    // passes 4/4 alone and failed inside the full run — 1072 files competing, and 300ms is not
    // enough for a spawned node process to boot, read stdin and write back. `rules/testing.md` § 6
    // names exactly this ("time in unit tests"), and the fix is not a longer sleep: a bigger number
    // is the same race with a lower failure rate. Polling for the condition makes the test fast on
    // an idle machine, reliable on a busy one, and failing only when the round-trip truly does not
    // happen.
    const deadline = Date.now() + 10_000
    while (!received.join('').includes('ok:hey') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    await transport.close()
    expect(
      received.join(''),
      'the echo agent never answered within 10s — this is the round-trip failing, not the machine',
    ).toContain('ok:hey')
  })
})

/** A scripted transport that counts `close()` calls and can report it closed on its own. */
function recordingTransport(options: Parameters<typeof scriptedTransport>[0] = {}) {
  const inner = scriptedTransport(options)
  const record = {
    closes: 0,
    signalClosed: (_error: AcpTransportClosedError): void => undefined,
  }
  const transport = {
    send: (line: string) => {
      inner.send(line)
    },
    subscribe: (onData: (chunk: string) => void) => {
      inner.subscribe(onData)
    },
    close: () => {
      record.closes += 1
    },
    onClose: (listener: (error: AcpTransportClosedError) => void) => {
      record.signalClosed = listener
    },
  }
  return { transport, record }
}

function toolOver(
  transport: ReturnType<typeof recordingTransport>['transport'],
  extra: { timeoutMs?: number } = {},
) {
  return createACPTool({
    command: 'scripted-agent',
    name: 'code_agent',
    description: 'd',
    onPermissionRequest: () => ({ granted: false }),
    transportFactory: () => transport,
    ...extra,
  })
}

describe('createACPTool releases its transport', () => {
  it('test_the_transport_is_closed_after_a_successful_call', async () => {
    const { transport, record } = recordingTransport()

    await expect(toolOver(transport).handler({ message: 'hi' })).resolves.toBe('echo:hi')

    expect(record.closes).toBe(1)
  })

  it('test_the_transport_is_closed_after_a_refused_step', async () => {
    const { transport, record } = recordingTransport({ refuse: 'session/new' })

    await expect(toolOver(transport).handler({ message: 'hi' })).rejects.toThrow(
      /refused session\/new: invalid params/,
    )

    expect(record.closes).toBe(1)
  })

  it('test_a_transport_that_closes_mid_turn_rejects_the_call_with_the_closed_error', async () => {
    const closed = new AcpTransportClosedError('scripted-agent', 'exited with code 3')
    const { transport, record } = recordingTransport({
      silentOn: 'session/prompt',
      onSend: (msg) => {
        if (msg.method === 'session/prompt') queueMicrotask(() => record.signalClosed(closed))
      },
    })

    const failure: unknown = await Promise.resolve(
      toolOver(transport).handler({ message: 'hi' }),
    ).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(failure).toBe(closed)
    expect(record.closes).toBe(1)
  })

  it('test_an_agent_that_never_answers_rejects_with_the_timeout_error', async () => {
    const { transport, record } = recordingTransport({ silentOn: 'session/prompt' })

    const failure: unknown = await Promise.resolve(
      toolOver(transport, { timeoutMs: 50 }).handler({ message: 'hi' }),
    ).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(failure).toBeInstanceOf(AcpRequestTimeoutError)
    expect((failure as AcpRequestTimeoutError).method).toBe('session/prompt')
    expect((failure as AcpRequestTimeoutError).timeoutMs).toBe(50)
    expect((failure as Error).message).toMatch(/scripted-agent.*session\/prompt.*50ms/)
    expect(record.closes).toBe(1)
  })

  it('test_a_timeout_that_is_not_a_positive_number_is_refused_at_creation', () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toolOver(recordingTransport().transport, { timeoutMs })).toThrow(
        /timeoutMs must be a positive finite number/,
      )
    }
  })
})

/** A transport whose agent answers the first request it receives with `chunk`, and nothing else. */
function answersFirstRequestWith(chunk: string) {
  let sink: ((data: string) => void) | undefined
  return {
    send: () => {
      queueMicrotask(() => sink?.(chunk))
    },
    subscribe: (onData: (data: string) => void) => {
      sink = onData
    },
  }
}

/** Settle `work` with its rejection, or with `undefined` when it resolved. */
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (err: unknown) => err,
  )
}

// Review findings F-arch-1 and F-xval-9: step() labelled every rejection of AcpClient.request a
// refusal, so on a transport a caller injects, a protocol break read "the agent refused initialize".
describe('createACPTool passes the client typed errors through', () => {
  it('test_a_protocol_break_on_an_injected_transport_rejects_with_the_protocol_error', async () => {
    const tool = createACPTool({
      command: 'scripted-agent',
      name: 'code_agent',
      description: 'd',
      onPermissionRequest: () => ({ granted: false }),
      transportFactory: () => answersFirstRequestWith('Starting agent v1.2\n'),
    })

    const failure = await failureOf(Promise.resolve(tool.handler({ message: 'hi' })))

    expect(failure).toMatchObject({ name: 'AcpProtocolError', line: 'Starting agent v1.2' })
    expect((failure as Error).message).not.toMatch(/refused/)
  })

  // Review finding F-arch-3: which error a closed transport produced depended on the tool's onClose
  // listener running after the client's and synchronously. A transport that tells only the first
  // listener it was given (a single `onclose` slot) reached the client alone, and the close read
  // "the agent refused session/prompt".
  it('test_a_close_reported_to_the_client_alone_rejects_with_the_transport_error', async () => {
    const closed = new AcpTransportClosedError('scripted-agent', 'exited with code 3')
    const inner = scriptedTransport({ silentOn: 'session/prompt' })
    let first: ((cause: Error) => void) | undefined
    const tool = createACPTool({
      command: 'scripted-agent',
      name: 'code_agent',
      description: 'd',
      onPermissionRequest: () => ({ granted: false }),
      transportFactory: () => ({
        send: (line: string) => {
          inner.send(line)
          if (line.includes('"session/prompt"')) queueMicrotask(() => first?.(closed))
        },
        subscribe: (onData: (chunk: string) => void) => {
          inner.subscribe(onData)
        },
        onClose: (listener: (cause: Error) => void) => {
          first ??= listener
        },
      }),
    })

    const failure = await failureOf(Promise.resolve(tool.handler({ message: 'hi' })))

    expect(failure).toBe(closed)
  })
})
