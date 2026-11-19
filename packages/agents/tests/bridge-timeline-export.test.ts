/**
 * B-376 — the SDK timeline translator crosses `@theokit/agents/bridge`, so a consumer that reads
 * `run.events()` (live text deltas) translates it with the framework's code instead of a copy.
 *
 * Imported from the package's own `./bridge` subpath, not `../src`: a unit suite against the source
 * says nothing about what the published `exports` carry, which is the claim here. Needs a build first.
 */
import {
  createToolSeen,
  flushPendingToolResults,
  type SdkMessage,
  type SdkTimelineEvent,
  translateTimelineEvent,
} from '@theokit/agents/bridge'
import { describe, expect, it } from 'vitest'

const assistantText = (text: string): SdkMessage =>
  ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }) as unknown as SdkMessage

describe('the bridge exports the timeline translator', () => {
  it('a text delta becomes one text_delta', () => {
    const delta: SdkTimelineEvent = { kind: 'delta', update: { type: 'text-delta', text: 'Hel' } }
    expect(translateTimelineEvent(delta, 'run-1', createToolSeen())).toEqual([
      { type: 'text_delta', content: 'Hel' },
    ])
  })

  it('a message marked textAlreadyStreamed yields no text_delta', () => {
    const message: SdkTimelineEvent = {
      kind: 'message',
      message: assistantText('Hello'),
      textAlreadyStreamed: true,
    }
    const events = translateTimelineEvent(message, 'run-1', createToolSeen())
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([])
  })

  it('a fresh tool seen state flushes nothing', () => {
    expect(flushPendingToolResults(createToolSeen())).toEqual([])
  })
})

describe('timeline narrowing helpers', () => {
  it('narrows message and delta events', async () => {
    const { isDeltaTimelineEvent, isMessageTimelineEvent } = await import('@theokit/agents/bridge')
    const msg: SdkTimelineEvent = { kind: 'message', message: assistantText('x') }
    const delta: SdkTimelineEvent = { kind: 'delta', update: { type: 'text-delta', text: 'a' } }
    expect(isMessageTimelineEvent(msg)).toBe(true)
    expect(isMessageTimelineEvent(delta)).toBe(false)
    expect(isDeltaTimelineEvent(delta)).toBe(true)
    expect(isDeltaTimelineEvent(msg)).toBe(false)
    const malformedDelta = { kind: 'delta' } as unknown as SdkTimelineEvent
    const malformedMessage = { kind: 'message' } as unknown as SdkTimelineEvent
    expect(isDeltaTimelineEvent(malformedDelta)).toBe(false)
    expect(isMessageTimelineEvent(malformedMessage)).toBe(false)
    expect(translateTimelineEvent(malformedDelta, 'r', createToolSeen())).toEqual([])
    expect(translateTimelineEvent(malformedMessage, 'r', createToolSeen())).toEqual([])
  })
})
