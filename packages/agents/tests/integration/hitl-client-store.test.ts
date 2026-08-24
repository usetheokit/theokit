/**
 * usetheokit/theokit#392 + #394 — what an APPLICATION sees while a gated tool waits for a human.
 *
 * ## Why this is not a unit test of the reducer
 *
 * A green reducer proves the code WORKS. The defect these issues reported is that the capability was
 * UNREACHABLE: every piece functioned, and no path connected them. The approval crossed the wire
 * (`hitl-call-correlation.test.ts` has asserted that since #361), the store had an `approve()`, and
 * between the two `readMessageStream` returned `false` and dropped the frame — so an application
 * holding the framework's own client could not name the decision it was being asked to make, and a
 * paused tool sat in `state: 'input-available'`, byte-identical to an ungated tool while it runs.
 *
 * Calling the reducer directly would have been green throughout that, because the reducer was never
 * the broken part. So this drives the whole served path and then asks the ONE question the reducer
 * cannot answer: what is in `client.getSnapshot()` while the human has not decided.
 *
 * ## What is real here
 *
 * Only `@theokit/sdk` is mocked, and the fake is shaped after the published one (the orderings and
 * the concurrency cases are pinned next door in `hitl-call-correlation.test.ts`; this file drives
 * one call and looks at the other end of the wire). Everything between the gate and the snapshot is
 * production code: `createHitlPlugin`, `presentUIMessageStream`, `streamAgentUIMessages`, a real
 * `node:http` server writing real SSE, the shipped `handleAgentApproval` at its shipped `strict`
 * CSRF default, `HttpTransport`, `parseWireStream`, `readMessageStream`, `consumeChunkStream` and
 * `AgentClient`.
 *
 * ## The application is the assertion
 *
 * `runApp` below is the whole client an approval prompt needs, and it is deliberately written the
 * way a consumer would write it: read `pendingApprovals`, render `question` (or fall back to
 * `toolName`), settle with `approve(entry.approvalId, …)`. It polls nothing, it calls
 * `GET /approvals` never, and it correlates no ids. That is the measured cost this closes — the J2
 * benchmark's client paid twelve lines of `setInterval` and an out-of-band endpoint for exactly
 * this, and priced the framework's loss on it (`docs/program/journeys/j02-hitl.md`).
 */
import 'reflect-metadata'

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WireChunk } from '@theokit/presenter/wire'

/** How long the fake human takes to answer, per test. */
const h = vi.hoisted(() => ({ toolResult: 'deployed' }))

/**
 * The SDK's dispatch for one tool call, reduced to what the gate depends on.
 *
 * Read from `@theokit/sdk@4.52.1`'s shipped `chunk-*.js`, same as the sibling file: the runtime
 * `tool_call` (`status: 'running'`) is pushed BEFORE the awaited veto hook, `PreToolCallContext`
 * carries no call id (which is why the plugin mints its own), and a veto completes the call with the
 * message on `stderr` and exit code 126.
 */
function createFakeRun(options: { plugins?: unknown[] }): {
  events: () => AsyncGenerator
  wait: () => Promise<Record<string, unknown>>
} {
  const timeline: unknown[] = []
  let terminated = false
  let notify: () => void = () => {}
  let wake = new Promise<void>((resolve) => {
    notify = resolve
  })
  const push = (message: Record<string, unknown>): void => {
    timeline.push({ kind: 'message', message })
    const wakeUp = notify
    wake = new Promise<void>((resolve) => {
      notify = resolve
    })
    wakeUp()
  }

  const hooks: ((ctx: unknown) => unknown)[] = []
  for (const plugin of options.plugins ?? []) {
    ;(
      plugin as { register: (ctx: { on: (n: string, f: (c: unknown) => unknown) => void }) => void }
    ).register({
      on: (name, handler) => {
        if (name === 'pre_tool_call') hooks.push(handler)
      },
    })
  }

  const call = (status: string, result?: unknown): Record<string, unknown> => ({
    type: 'tool_call',
    agent_id: 'agent-1',
    run_id: 'run-1',
    call_id: 'call_sdk-1',
    name: 'ops_deploy',
    status,
    args: { env: 'prod' },
    ...(result === undefined ? {} : { result }),
  })

  void (async () => {
    push(call('running'))
    let veto: { block: true; message: string } | undefined
    for (const hook of hooks) {
      const decision = (await hook({
        name: 'ops_deploy',
        args: { env: 'prod' },
        agentId: 'agent-1',
        runId: 'run-1',
      })) as { block?: boolean; message: string } | undefined
      if (decision?.block === true) {
        veto = decision as { block: true; message: string }
        break
      }
    }
    push(
      call(
        'completed',
        veto === undefined
          ? { stdout: h.toolResult, stderr: '', exitCode: 0 }
          : { stdout: '', stderr: veto.message, exitCode: 126 },
      ),
    )
    terminated = true
    notify()
  })()

  return {
    events: async function* () {
      let index = 0
      while (!terminated) {
        while (index < timeline.length) yield timeline[index++]
        if (terminated) break
        await wake
      }
      while (index < timeline.length) yield timeline[index++]
    },
    wait: async () => ({ result: 'ok', usage: { inputTokens: 1, outputTokens: 2 } }),
  }
}

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string, options: { plugins?: unknown[] }) => ({
      agentId: id,
      send: async () => createFakeRun(options),
      dispose: async () => {},
    })),
  },
}))

const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { AgentClient } = await import('../../src/client/agent-client.js')
const { HttpTransport } = await import('../../src/client/http-transport.js')
const { createInProcessApprovalRegistry } =
  await import('../../../theo/src/server/agent/approval-registry.js')
const { handleAgentApproval } = await import('../../../theo/src/server/agent/approve-agent.js')
const { z } = await import('zod')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ToolboxCapability } = await import('../../src/capability/toolbox.js')

interface ChatInput {
  message: string
}
type ChatClient = InstanceType<typeof AgentClient<ChatInput>>
type PendingApprovalShape = ReturnType<ChatClient['getSnapshot']>['pendingApprovals'][number]

/** One `@HumanInTheLoop` tool, declared with the question and window a real gate declares. */
function gatedAgent() {
  class OpsTools {
    static readonly tools = [
      {
        name: 'deploy',
        description: 'Deploy to prod',
        input: z.object({ env: z.string() }),
        method: 'deploy',
        hitl: { question: 'Deploy to prod?', timeout: 30_000, onTimeout: 'abort' as const },
      },
    ]
    async deploy(): Promise<string> {
      return 'deployed'
    }
  }
  return applyCapabilities([new ToolboxCapability(new OpsTools(), { namespace: 'ops' })])
}

let server: Server | undefined

afterEach(async () => {
  const running = server
  server = undefined
  if (running) await new Promise<void>((resolve) => running.close(() => resolve()))
})

/**
 * Serve the agent the way `mountAgent` does — one POST for the turn, one for the decision.
 *
 * `gate: false` runs the SAME compiled agent with no `hitl` wiring, which is the ungated branch
 * `agent-endpoint.ts` already had (`if (!input.hitl || input.hitl.gated.size === 0)`). Exactly one
 * variable separates the two lanes, which is what makes the no-regression assertion mean something.
 */
async function serveAgent(options: { gate: boolean }): Promise<string> {
  const compiled = gatedAgent()
  const registry = createInProcessApprovalRegistry()
  const gated = compiled.hitl
  if (gated === undefined) throw new Error('fixture: expected a gated tool')
  const hitl = {
    gated,
    awaitApproval: (approvalId: string, opts: { timeout?: number; onTimeout?: string }) =>
      registry.register(approvalId, {
        timeoutMs: opts.timeout ?? 300_000,
        onTimeout: opts.onTimeout === 'proceed' ? ('proceed' as const) : ('abort' as const),
      }),
  }

  const running = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '/'
      if (path.includes('/approve/')) {
        // The SHIPPED handler, at its shipped `strict` CSRF default, reached with exactly the
        // headers `HttpTransport.approve` sends. Nothing about the caller's identity is asserted
        // here — that is the subject of a separate, private advisory and is not this file's claim.
        const body = await new Promise<string>((resolve) => {
          let raw = ''
          req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
          req.on('end', () => resolve(raw))
        })
        const request = new Request(`http://127.0.0.1${path}`, {
          method: 'POST',
          headers: Object.entries(req.headers).flatMap(([k, v]) =>
            typeof v === 'string' ? [[k, v] as [string, string]] : [],
          ),
          body,
        })
        const response = await handleAgentApproval(request, path, registry)
        res.writeHead(response.status, { 'content-type': 'application/json' })
        res.end(await response.text())
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-theokit-run-id': 'run-hitl-1',
      })
      for await (const chunk of streamAgentUIMessages(compiled, 'test-key', {
        message: 'deploy please',
        sessionId: 'sess-1',
        ...(options.gate ? { hitl } : {}),
        // #390 masks a failure's text before it reaches a browser. These cases assert WHICH chunk a
        // failure produces and under which id — not what it says — so they opt out explicitly.
        onError: (e) => e.message,
      })) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })()
  })
  server = running
  await new Promise<void>((resolve) => running.listen(0, '127.0.0.1', resolve))
  const { port } = running.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}/api/agents/chat`
}

interface AppRun {
  /** Every distinct set of outstanding decisions the app was shown, in order. */
  readonly seen: PendingApprovalShape[][]
  /** What the app would have rendered as the prompt, for each decision it settled. */
  readonly prompts: string[]
  readonly client: ChatClient
}

/**
 * The application. This is the whole thing — read the outstanding decisions off the hook's state,
 * render one, settle it by the id the same state handed over.
 */
async function runApp(api: string, decide: (a: PendingApprovalShape) => boolean): Promise<AppRun> {
  const client = new AgentClient<ChatInput>(new HttpTransport({ api }))
  const seen: PendingApprovalShape[][] = []
  const prompts: string[] = []
  const settled = new Set<string>()

  const finished = new Promise<void>((resolve) => {
    const unsubscribe = client.subscribe(() => {
      const { status, pendingApprovals } = client.getSnapshot()
      if (seen.at(-1) !== pendingApprovals) seen.push(pendingApprovals)
      for (const approval of pendingApprovals) {
        if (settled.has(approval.approvalId)) continue
        settled.add(approval.approvalId)
        prompts.push(approval.question ?? `Run ${String(approval.toolName)}?`)
        void client.approve(approval.approvalId, { approved: decide(approval) })
      }
      if (status !== 'streaming') {
        unsubscribe()
        resolve()
      }
    })
  })
  client.send({ message: 'deploy please' })
  await finished
  return { seen, prompts, client }
}

/** The tool part of the current turn, whatever state it is in. */
function toolPart(client: ChatClient): Record<string, unknown> | undefined {
  return client
    .getSnapshot()
    .messages.flatMap((m) => m.parts)
    .find((p) => p.type === 'dynamic-tool') as Record<string, unknown> | undefined
}

describe('theokit#392 — an application can see, name and settle a pending approval', () => {
  it('test_the_store_publishes_the_decision_while_the_run_is_paused', async () => {
    const api = await serveAgent({ gate: true })

    const { seen, prompts, client } = await runApp(api, () => true)

    // The reported defect, inverted: there WAS a moment where the store said a decision was
    // outstanding, and it named it well enough to render and to settle.
    const outstanding = seen.find((s) => s.length > 0)
    expect(outstanding, 'the store never published a pending approval').toBeDefined()
    expect(outstanding).toHaveLength(1)
    expect(outstanding?.[0]).toEqual({
      approvalId: expect.any(String) as unknown as string,
      toolCallId: expect.any(String) as unknown as string,
      toolName: 'ops_deploy',
      input: { env: 'prod' },
      // #394 — the question the agent's author declared, and the window it expires in. Neither has
      // any other carrier; before this they existed only inside the process and on the unauthenticated
      // listing endpoint.
      question: 'Deploy to prod?',
      timeoutMs: 30_000,
    })
    // Rendered from the store alone, with no string the application had to restate.
    expect(prompts).toEqual(['Deploy to prod?'])

    // Settling it with the id the store handed over resumed the same run and ran the tool.
    expect(client.getSnapshot().status).toBe('done')
    // Anchored on what the producer ACTUALLY emits, not on what a fixture author would write: the
    // SDK completes a call with a process result, and the translator carries it through verbatim.
    expect(toolPart(client)).toMatchObject({
      state: 'output-available',
      output: JSON.stringify({ stdout: 'deployed', stderr: '', exitCode: 0 }),
    })
    // And nothing is left outstanding: the last thing the app was shown is empty.
    expect(seen.at(-1)).toEqual([])
  })

  it('test_a_paused_tool_does_not_look_like_a_running_one', async () => {
    // The half of #392 that is not about the id. `input-available` is what an UNGATED tool looks
    // like while it runs, so while the store reported it a surface could not distinguish "working"
    // from "waiting for you" — and would have rendered a spinner for a run that was not moving.
    const api = await serveAgent({ gate: true })

    const states: unknown[] = []
    const client = new AgentClient<ChatInput>(new HttpTransport({ api }))
    const settled = new Set<string>()
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = client.subscribe(() => {
        const snapshot = client.getSnapshot()
        const part = toolPart(client)
        if (part && states.at(-1) !== part.state) states.push(part.state)
        for (const approval of snapshot.pendingApprovals) {
          if (settled.has(approval.approvalId)) continue
          settled.add(approval.approvalId)
          void client.approve(approval.approvalId, { approved: true })
        }
        if (snapshot.status !== 'streaming') {
          unsubscribe()
          resolve()
        }
      })
    })
    client.send({ message: 'deploy please' })
    await finished

    expect(states).toContain('approval-requested')
    // The state is one the call LEAVES — otherwise a surface keyed on it shows a prompt forever.
    expect(states.at(-1)).toBe('output-available')
  })

  it('test_a_denied_decision_settles_from_the_same_place_and_never_runs_the_tool', async () => {
    h.toolResult = 'deployed'
    const api = await serveAgent({ gate: true })

    const { prompts, client } = await runApp(api, () => false)

    expect(prompts).toEqual(['Deploy to prod?'])
    expect(client.getSnapshot().pendingApprovals).toEqual([])
    // #388 — a refused call reports as a failure, and it carries the refusal rather than an output.
    const part = toolPart(client)
    expect(part?.state).toBe('output-error')
    expect(String(part?.errorText)).toContain('denied by human approver')
    expect(part?.output).toBeUndefined()
  })
})

describe('theokit#392 — a tool with no gate is unchanged', () => {
  it('test_an_ungated_run_produces_the_same_snapshot_it_always_did', async () => {
    // The regression this could plausibly have caused, pinned exactly rather than approximately: a
    // reader that folds a new frame into a tool part, and a store that grew a key, must leave a run
    // with no gate byte-identical. `toEqual` on the whole snapshot, not `toMatchObject`.
    const api = await serveAgent({ gate: false })

    const client = new AgentClient<ChatInput>(new HttpTransport({ api }))
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = client.subscribe(() => {
        if (client.getSnapshot().status !== 'streaming') {
          unsubscribe()
          resolve()
        }
      })
    })
    client.send({ message: 'deploy please' })
    await finished

    const snapshot = client.getSnapshot()
    expect(Object.keys(snapshot).sort((a, b) => a.localeCompare(b))).toEqual([
      'error',
      'messages',
      'pendingApprovals',
      'status',
      'thread',
    ])
    expect(snapshot.status).toBe('done')
    expect(snapshot.error).toBeUndefined()
    // The only new key, and on this path it is the empty array — never a decision nobody asked for.
    expect(snapshot.pendingApprovals).toEqual([])
    expect(snapshot.messages.flatMap((m) => m.parts)).toEqual([
      {
        type: 'dynamic-tool',
        toolName: 'ops_deploy',
        toolCallId: 'call_sdk-1',
        state: 'output-available',
        input: { env: 'prod' },
        output: JSON.stringify({ stdout: 'deployed', stderr: '', exitCode: 0 }),
      },
    ])
  })

  it('test_an_ungated_run_emits_no_approval_frame_of_any_kind', async () => {
    // The wire half of the same claim, read where a consumer reads it. `data-approval` is new
    // surface; a run with no gate must not carry it any more than it carries the gate itself.
    const api = await serveAgent({ gate: false })
    const response = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ message: 'deploy please' }),
    })
    const body = await response.text()
    const chunks = body
      .split('\n\n')
      .map((frame) => frame.replace(/^data: /, '').trim())
      .filter((frame) => frame.length > 0 && frame !== '[DONE]')
      .map((frame) => JSON.parse(frame) as WireChunk)

    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'tool-input-available',
      'tool-output-available',
      'finish',
    ])
  })
})
