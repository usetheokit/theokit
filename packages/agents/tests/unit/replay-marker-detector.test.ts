import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateInteractionUpdate, translateSdkEvent } from '../../src/bridge/event-translator.js'
import {
  detectsReplayMarker,
  noteReplayMarker,
  resetReplayMarkerNotice,
} from '../../src/bridge/replay-marker-detector.js'

/**
 * The model typed the SDK's own replay marker (usetheokit/theokit#631).
 *
 * The reported cost was not the marker — it was the diagnosis. A consumer saw
 * `"…report its output.[tool call] run_shell"` in the timeline, read it as the model misbehaving,
 * and changed the prompt; the marker is `@theokit/sdk`'s, and no prompt was ever going to fix it.
 *
 * These tests pin the detector and the notice. What they deliberately do NOT assert is any change
 * to the text: see the module docblock for why altering it would be worse than the defect.
 */
describe('detectsReplayMarker', () => {
  it('recognises the tool-call fold', () => {
    expect(detectsReplayMarker("I'll run that exact command.[tool call] run_shell")).toBe(true)
  })

  it('recognises the tool-result fold', () => {
    expect(detectsReplayMarker('[tool result] {"ok":true}')).toBe(true)
  })

  it('is not fooled by ordinary prose about tools', () => {
    expect(detectsReplayMarker('I will call the tool now.')).toBe(false)
    expect(detectsReplayMarker('The tool call failed.')).toBe(false)
    expect(detectsReplayMarker('[tool] call')).toBe(false)
  })

  it('requires the marker to be followed by something, as the SDK writes it', () => {
    // `partToText` renders `[tool call] ${name}`. The bare bracket alone is not the fold.
    expect(detectsReplayMarker('[tool call]')).toBe(false)
  })
})

describe('noteReplayMarker', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetReplayMarkerNotice()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    resetReplayMarkerNotice()
  })

  it('names the cause, not the symptom', () => {
    noteReplayMarker('done.[tool call] run_shell')

    expect(warn).toHaveBeenCalledTimes(1)
    const said = String(warn.mock.calls[0][0])
    // The three things the consumer had to work out for themselves, over an afternoon.
    expect(said).toContain('@theokit/sdk')
    expect(said).toContain('#631')
    expect(said).toMatch(/resum|replay|history/i)
  })

  it('says it once, however many times the marker appears', () => {
    noteReplayMarker('a[tool call] one')
    noteReplayMarker('b[tool call] two')
    noteReplayMarker('c[tool result] three')

    // A line repeated per token is a line that gets filtered out — the same reason the undeclared
    // route warning is emitted once per route rather than once per request.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stays silent on text that carries no marker', () => {
    noteReplayMarker('I will call the tool now.')
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns nothing — it observes a stream it does not own', () => {
    // The text arriving unchanged at the consumer is asserted through the real translation path
    // below, which is where it would actually be lost.
    expect(noteReplayMarker('done.[tool call] run_shell')).toBeUndefined()
  })
})

describe('the notice reaches the real translation path (#631)', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetReplayMarkerNotice()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    resetReplayMarkerNotice()
  })

  const assistantSaying = (text: string) => ({
    type: 'assistant',
    agent_id: 'a',
    run_id: 'run-631',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })

  it('fires on a complete assistant message, and the text still crosses whole', () => {
    // A detector with a passing unit test and no caller is the shape #574 and #429 both paid for.
    const events = translateSdkEvent(assistantSaying('done.[tool call] run_shell'), 'run-631')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(events).toEqual([{ type: 'text_delta', content: 'done.[tool call] run_shell' }])
  })

  it('fires on the token path too', () => {
    const events = translateInteractionUpdate({
      type: 'text-delta',
      text: '[tool call] run_shell',
    } as never)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(events).toEqual([{ type: 'text_delta', content: '[tool call] run_shell' }])
  })

  it('stays quiet on an ordinary turn', () => {
    translateSdkEvent(assistantSaying('I will call the tool now.'), 'run-631')
    expect(warn).not.toHaveBeenCalled()
  })
})
