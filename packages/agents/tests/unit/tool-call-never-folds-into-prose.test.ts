import { readMessageStream } from '@theokit/presenter/wire'
import type { WireChunk, WireMessage } from '@theokit/presenter/wire'
import { describe, expect, it } from 'vitest'

import { translateSdkEvent } from '../../src/bridge/event-translator.js'
import { presentUIMessageStream } from '../../src/bridge/present-ui-message-stream.js'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'

/**
 * A tool call crosses this bridge as a tool, never as prose (usetheokit/theokit#631).
 *
 * The report is a message reaching `agent.thread` as one `text` part reading
 * `"…report its output.[tool call] run_shell"` — the SDK's LOSSY projection (`partToText`, which
 * folds a `tool_use` to `[tool call] NAME` and drops the call id and every argument) surfacing where
 * a card UI expected structure. `@theokit/tui`'s renderer does the right thing with structured
 * parts, so a consumer can recover nothing once the fold has happened.
 *
 * The existing translator tests cover a text block ALONE and a tool_use block ALONE. The reported
 * shape is both in ONE message, which is the case where a fusion would actually occur — so it was
 * the one case nothing asserted. These tests take that shape through both stages this repository
 * owns, and assert the negative the issue is about: the marker never appears in anything the wire
 * carries.
 *
 * What this does NOT prove: that the string cannot arrive from somewhere else. `partToText` lives in
 * `@theokit/sdk` and its only caller there is `readSessionMessages` (`Agent.transcript`), which no
 * file in this repository calls — see the investigation on the issue. This locks the half that is
 * ours.
 */

const RUN = 'run-631'

/** The reported shape: the model's sentence and the tool call, in one assistant message. */
const TEXT_AND_TOOL = {
  type: 'assistant',
  agent_id: 'a',
  run_id: RUN,
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: "I'll run that exact command and report its output." },
      { type: 'tool_use', id: 'tu-631', name: 'run_shell', input: { command: 'ls' } },
    ],
  },
}

describe('a text block and a tool_use block in one message (#631)', () => {
  it('translates to two events, and the tool is a tool', () => {
    expect(translateSdkEvent(TEXT_AND_TOOL, RUN)).toEqual([
      { type: 'text_delta', content: "I'll run that exact command and report its output." },
      { type: 'tool_call', callId: 'tu-631', toolName: 'run_shell', input: { command: 'ls' } },
    ])
  })

  it('never appends the tool name to the text', () => {
    const [text] = translateSdkEvent(TEXT_AND_TOOL, RUN)
    const content = String(text.content)

    // The exact defect: the sentence and the marker fused with no separator.
    expect(text).toMatchObject({ type: 'text_delta' })
    expect(content).not.toContain('[tool call]')
    expect(content).toBe("I'll run that exact command and report its output.")
  })
})

describe('the same shape, all the way to the wire (#631)', () => {
  async function chunksFor(events: AgentStreamEvent[]): Promise<Record<string, unknown>[]> {
    async function* source(): AsyncGenerator<AgentStreamEvent> {
      for (const event of events) yield event
    }
    const out: Record<string, unknown>[] = []
    for await (const chunk of presentUIMessageStream(source(), { textId: 'text-631' })) {
      out.push(chunk as unknown as Record<string, unknown>)
    }
    return out
  }

  it('carries the call id, the name and the arguments as a tool chunk', async () => {
    const chunks = await chunksFor(translateSdkEvent(TEXT_AND_TOOL, RUN) as AgentStreamEvent[])

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'tu-631',
        toolName: 'run_shell',
        input: { command: 'ls' },
      }),
    )
  })

  it('emits the model text once, with nothing appended', async () => {
    const chunks = await chunksFor(translateSdkEvent(TEXT_AND_TOOL, RUN) as AgentStreamEvent[])

    const deltas = chunks.filter((c) => c.type === 'text-delta').map((c) => String(c.delta))
    expect(deltas).toEqual(["I'll run that exact command and report its output."])
  })

  it('puts the marker in no chunk at all', async () => {
    const chunks = await chunksFor(translateSdkEvent(TEXT_AND_TOOL, RUN) as AgentStreamEvent[])

    // The assertion a consumer actually cares about, stated over the whole wire rather than
    // per-chunk: if this string is anywhere, a card UI is about to render prose.
    expect(JSON.stringify(chunks)).not.toContain('[tool call]')
  })
})

describe('and the message a consumer finally reads (#631)', () => {
  it('arrives as two parts — a text part and a tool part — not one prose part', async () => {
    const events = translateSdkEvent(TEXT_AND_TOOL, RUN) as AgentStreamEvent[]
    async function* source(): AsyncGenerator<AgentStreamEvent> {
      for (const event of events) yield event
    }

    const wire = new ReadableStream<WireChunk>({
      async start(controller) {
        for await (const chunk of presentUIMessageStream(source(), { textId: 'text-631' })) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })

    let last: WireMessage | undefined
    for await (const message of readMessageStream(wire)) last = message

    // This is the assertion the issue's JSON dump fails: one `text` part carrying both.
    expect(last?.parts).toEqual([
      expect.objectContaining({
        type: 'text',
        text: "I'll run that exact command and report its output.",
      }),
      expect.objectContaining({
        type: 'dynamic-tool',
        toolName: 'run_shell',
        toolCallId: 'tu-631',
        input: { command: 'ls' },
      }),
    ])
  })
})
