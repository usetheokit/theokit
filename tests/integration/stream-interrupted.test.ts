/**
 * theokit#384 — a run whose CONNECTION dies mid-stream reaches the caller as a cut run, not as an
 * ordinary `done`.
 *
 * ## What this pins, and why a unit test would not have
 *
 * The sibling of #379 one transport down: there a step ceiling truncated a run in silence, here a
 * socket does. The defect was never "a helper computes the wrong status" — nothing computed one.
 * `consumeChunkStream` returned `void`, so `AgentClient.#drive` had exactly two outcomes to choose
 * between: the reader threw (`'error'`) or it did not (`'done'`). A stream that simply STOPS throws
 * nothing, so the second branch swallowed it.
 *
 * A unit test of the reader against a hand-written `ReadableStream` that `close()`s would have been
 * green against that, because the fixture and the code shared the assumption that a closed stream is
 * a finished run. So this test cuts a REAL socket: a real `node:http` server writes three real SSE
 * frames of an unfinished run and calls `res.end()`, and a real `AgentClient` over a real
 * `HttpTransport` consumes it. Everything between the wire and the store is production code —
 * `parseWireStream`, `readMessageStream`, `consumeChunkStream`, `#drive`.
 *
 * ## The frames are the ones the issue observed
 *
 * `start`, `text-start`, one `text-delta` carrying `"Half an ans"` — cut inside the word "answer",
 * which is what the reproduction in theokit#384 recorded, with `id:` lines because the durable
 * encoder writes them (`durable-ui-message-stream-response.ts`).
 *
 * ## The clean case is pinned EXACTLY, on purpose
 *
 * `test_a_stream_that_ends_on_its_terminator_still_settles_exactly_done` compares the whole
 * `{status, error}` pair with `toEqual` and asserts the snapshot's key set, so a fix that reports
 * the interruption by stamping every clean turn with a new field fails here instead of in a
 * consumer — the same guarantee #379 wrote for `stopReason`'s absence.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AgentClient,
  AgentStreamInterruptedError,
} from '../../packages/agents/src/client/agent-client.js'
import { HttpTransport } from '../../packages/agents/src/client/http-transport.js'

/** The three frames of a run that had started answering. No `finish`, no `[DONE]`. */
const UNFINISHED_FRAMES = [
  'id: 0\ndata: {"type":"start"}\n\n',
  'id: 1\ndata: {"type":"text-start","id":"t0"}\n\n',
  'id: 2\ndata: {"type":"text-delta","id":"t0","delta":"Half an ans"}\n\n',
]

/** What the same run writes when it gets to finish: the block closes and the terminal frame flushes. */
const TERMINAL_FRAMES = [
  'id: 3\ndata: {"type":"text-end","id":"t0"}\n\n',
  'id: 4\ndata: {"type":"finish"}\n\n',
  'data: [DONE]\n\n',
]

let server: Server | undefined

afterEach(async () => {
  const running = server
  server = undefined
  if (running) await new Promise<void>((resolve) => running.close(() => resolve()))
})

/**
 * Start a real SSE server that writes `frames` and then ends the response.
 *
 * `res.end()` with no terminal frame is a CLEAN TCP close — which is the whole point: the client's
 * `reader.read()` reports `done` and nothing throws, so a truncation is indistinguishable from a
 * completion unless something on the wire says otherwise.
 */
async function serve(frames: readonly string[]): Promise<string> {
  const running = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-theokit-run-id': 'run-drop-1',
    })
    for (const frame of frames) res.write(frame)
    res.end()
  })
  server = running
  await new Promise<void>((resolve) => running.listen(0, '127.0.0.1', resolve))
  const { port } = running.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}/api/agents/chat`
}

/** Drive one turn against `api` and resolve with the client once its status leaves 'streaming'. */
async function runTurn(api: string): Promise<AgentClient<{ message: string }>> {
  const client = new AgentClient<{ message: string }>(new HttpTransport({ api }))
  const settled = new Promise<void>((resolve) => {
    const unsubscribe = client.subscribe(() => {
      if (client.getSnapshot().status !== 'streaming') {
        unsubscribe()
        resolve()
      }
    })
  })
  client.send({ message: 'hello' })
  await settled
  return client
}

/** The assistant text the store reconstructed for the current turn. */
function textOf(client: AgentClient<{ message: string }>): string {
  return client
    .getSnapshot()
    .messages.flatMap((m) => m.parts)
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

describe('theokit#384 — a dropped connection is not a finished run', () => {
  it('test_a_connection_cut_mid_answer_settles_in_error_instead_of_done', async () => {
    const client = await runTurn(await serve(UNFINISHED_FRAMES))
    const snapshot = client.getSnapshot()

    // The lie the issue measured: `status: 'done'`, `error: null`, half a word on screen.
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBeInstanceOf(AgentStreamInterruptedError)
    // The half-answer STAYS readable. Reporting the interruption must not also erase what arrived —
    // the user is told the answer is incomplete, not shown an empty turn.
    expect(textOf(client)).toBe('Half an ans')
  })

  it('test_the_interruption_declares_itself_retryable_so_a_caller_can_reconnect', async () => {
    const client = await runTurn(await serve(UNFINISHED_FRAMES))
    const error = client.getSnapshot().error

    // The reconnect trigger the issue found disabled. A caller decides on the TYPE, never on the
    // message text — `isTransientError` is defined over `TheokitAgentError`, which is why this
    // class joins that hierarchy instead of extending `Error`.
    expect(error).toBeInstanceOf(AgentStreamInterruptedError)
    expect((error as AgentStreamInterruptedError).isRetryable).toBe(true)
    expect((error as AgentStreamInterruptedError).code).toBe('AGENT_STREAM_INTERRUPTED')
    // The count is the diagnostic that separates "the server said nothing" from "cut mid-answer".
    expect((error as AgentStreamInterruptedError).chunksReceived).toBe(3)
  })

  it('test_a_truncated_turn_is_not_committed_into_the_thread_as_a_finished_one', async () => {
    const client = await runTurn(await serve(UNFINISHED_FRAMES))
    expect(textOf(client), 'precondition: the truncated turn produced text').toBe('Half an ans')

    // `send()` commits the PRIOR turn only when it settled on `done` — the second consequence the
    // issue names. With the status corrected, the half-answer is dropped from history instead of
    // being written into it as a completed turn. `thread` is then just the new user message.
    client.send({ message: 'again' })
    const thread = client.getSnapshot().thread
    expect(thread).toHaveLength(1)
    expect(thread[0].role).toBe('user')
    client.abort()
  })

  it('test_a_stream_that_ends_on_its_terminator_still_settles_exactly_done', async () => {
    const client = await runTurn(await serve([...UNFINISHED_FRAMES, ...TERMINAL_FRAMES]))
    const snapshot = client.getSnapshot()

    // EXACT, not `toBe('done')`: a fix that reports interruption by adding a field to every
    // snapshot would pass a status check and still change what every existing consumer receives.
    expect({ status: snapshot.status, error: snapshot.error }).toEqual({
      status: 'done',
      error: undefined,
    })
    expect(Object.keys(snapshot).sort((a, b) => a.localeCompare(b))).toEqual([
      'error',
      'messages',
      'status',
      'thread',
    ])
    expect(textOf(client)).toBe('Half an ans')
  })
})
