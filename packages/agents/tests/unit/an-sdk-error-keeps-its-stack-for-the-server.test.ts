/**
 * The stack must survive the flattening, for the server only.
 *
 * `sdkErrorEvent` turns a thrown `Error` into `{ type, code, message, retryable }`. That is the only
 * place the Error OBJECT is still alive — everything downstream sees the flattened event — and it
 * dropped `stack`. So the one thing that names WHERE a turn failed was destroyed at the boundary, and
 * the operator was left with a message.
 *
 * Measured on 2026-09-28. B-322 had just made the masked message reachable, and the message alone was
 * not enough to act on:
 *
 *     [theokit] agent turn failed (SDK_ERROR): [unenv] fs.readFile is not implemented yet!
 *
 * That is a Node builtin refusing on Workers, and `readFile` has six plausible call sites in the SDK.
 * Without a stack the next step is guessing which one, and a guess costs a deploy per candidate. With
 * one it costs a read.
 *
 * ## Why not on the wire
 *
 * A stack names files, directories and sometimes an argument. `MASK_ERROR` exists precisely to keep
 * that away from a browser, so this field is carried for the server logger and `errorChunks` never
 * puts it on a chunk — it constructs each chunk explicitly rather than spreading the event, which is
 * what makes that guarantee structural rather than a habit.
 *
 * ## Why here and not a second log
 *
 * `rules/error-handling.md` forbids logging an error and re-raising it — "duplica log sem adicionar
 * valor". `present-ui-message-stream` already logs at the masking boundary and covers error events
 * from every source, not only the SDK. So this adds the missing INFORMATION to the event rather than
 * a second place that prints.
 */
import { describe, expect, it } from 'vitest'

import { sdkErrorEvent } from '../../src/bridge/sdk-error.js'

describe('an SDK error keeps its stack for the server', () => {
  it('carries the stack when the thrown value is an Error', () => {
    const thrown = new Error('[unenv] fs.readFile is not implemented yet!')

    const event = sdkErrorEvent(thrown)

    expect(
      (event as { stack?: string }).stack,
      'the stack was dropped at the only place the Error object still existed, so a failing turn ' +
        'names no call site and the next step is guessing which of six readFile callers ran',
    ).toBe(thrown.stack)
  })

  it('keeps the fields it already promised', () => {
    // COUNTERPROOF: adding a field must not disturb the four the wire depends on.
    const event = sdkErrorEvent(
      Object.assign(new Error('boom'), { code: 'RATE_LIMIT', isRetryable: true }),
    )

    expect(event.type).toBe('error')
    expect(event.code).toBe('RATE_LIMIT')
    expect(event.message).toBe('boom')
    expect(event.retryable).toBe(true)
  })

  it('has no stack when the thrown value is not an Error', () => {
    // A string, a number, a rejected non-Error. `stack` must be absent rather than the string
    // `"undefined"`, which a template would produce and a log would then print as if it meant
    // something.
    const event = sdkErrorEvent('not an error at all')

    expect((event as { stack?: string }).stack).toBeUndefined()
    expect(event.message).toBe('SDK agent error')
  })

  it('does not put the stack on the wire', async () => {
    // THE guarantee. A stack names files and directories, and `MASK_ERROR` exists to keep exactly
    // that from a browser. This asserts on the CHUNKS the translator emits, not on the event.
    const { presentUIMessageStream } = await import('../../src/bridge/present-ui-message-stream.js')
    const thrown = new Error('failed while reading /etc/theo/creds.json')

    async function* turn(): AsyncGenerator<never, void, unknown> {
      yield sdkErrorEvent(thrown) as never
    }

    const chunks: unknown[] = []
    for await (const chunk of presentUIMessageStream(turn(), { textId: 't' })) chunks.push(chunk)
    const wire = JSON.stringify(chunks)

    expect(wire).toContain('An error occurred.')
    expect(
      wire,
      'the stack reached the wire, which is what MASK_ERROR exists to prevent',
    ).not.toContain('at ')
    expect(wire).not.toContain('/etc/theo/creds.json')
  })
})
