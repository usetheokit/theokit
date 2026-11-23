/** The processors read the wire through the framework's `createWireReader` / `readTurnMetadata`. */
import { describe, expect, it } from 'vitest'

import { createHumanProcessor, createJsonlProcessor } from './wire-driver.js'
import type { ExecIo } from '../../src/runtime/events.js'

function capture(): { io: ExecIo; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err }
}

const finish = (messageMetadata: unknown) => ({ type: 'finish' as const, messageMetadata })

describe('finish metadata', () => {
  it('reads usage and stop reason, and reports a cut turn', () => {
    const { io, err } = capture()
    const p = createHumanProcessor(io, 's')
    p.process(
      finish({
        usage: { inputTokens: 10, cacheReadTokens: 4, outputTokens: 3 },
        stopReason: 'step_limit',
      }) as never,
    )
    const r = p.finish('finished')
    expect(r.stopReason).toBe('step_limit')
    expect(r.usage).toMatchObject({ input_tokens: 10, cached_input_tokens: 4, output_tokens: 3 })
    expect(err.at(-1)).toBe('[exec] session=s status=cut stop=step_limit tokens=9')
  })

  it('drops a field of the wrong type instead of trusting it', () => {
    const { io } = capture()
    const p = createJsonlProcessor(io, 's')
    p.process(finish({ usage: { inputTokens: 'lots' }, stopReason: 'bogus' }) as never)
    const r = p.finish('finished')
    expect(r.stopReason).toBeUndefined()
    expect(r.usage.input_tokens).toBe(0)
  })
})

describe('tool calls and errors', () => {
  it('keeps the tool name for the result and marks an error as seen', () => {
    const { io, err } = capture()
    const p = createHumanProcessor(io, 's')
    p.process({
      type: 'tool-input-available',
      toolCallId: 'c1',
      toolName: 'bash',
      input: {},
    } as never)
    p.process({ type: 'tool-output-error', toolCallId: 'c1', errorText: 'nope' } as never)
    p.process({ type: 'error', errorText: 'boom' } as never)
    const r = p.finish('finished')
    expect(r.errorSeen).toBe(true)
    expect(err.join('\n')).toContain('failed')
    expect(err.join('\n')).toContain('ERROR: boom')
  })
})
