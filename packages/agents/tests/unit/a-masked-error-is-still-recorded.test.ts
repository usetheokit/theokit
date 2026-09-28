/**
 * Masking an error from the browser must not destroy it.
 *
 * `MASK_ERROR` replaces every message outside a two-code allowlist with `'An error occurred.'`, and
 * its docblock argues that correctly: the text could name a host, a path, a query or a credential, so
 * a browser may not read it. Nothing about that is wrong.
 *
 * What was wrong is that the unmasked message went nowhere else. `presentUIMessageStream` passed
 * `event.message` straight into `onError` and yielded the result, so the original was destroyed at
 * that line — which is the swallowed-error anti-pattern `rules/error-handling.md` forbids by name:
 * *"`catch (Exception e) { log.error("error"); }` — swallowed; nobody learns what happened."*
 *
 * Measured, 2026-09-28 (B-322). A deployed Cloudflare worker and a local `wrangler dev --local` both
 * answered an agent turn with exactly this and nothing else:
 *
 *     data: {"type":"data-error-code","data":{"code":"SDK_ERROR"},"transient":true}
 *     data: {"type":"error","errorText":"An error occurred."}
 *
 * Server logs: empty. So the one place that held the cause discarded it, and the operator had a
 * failing chat with no way to learn why — on a platform where attaching a debugger is not an option.
 *
 * ## What the fix is, and what it is not
 *
 * It is: record the unmasked message server-side, with its code, before masking. Mask outward, log
 * inward.
 *
 * It is NOT widening `UNMASKED_CODES`. That set is a decision about what a browser may read, and the
 * defect was never that the client saw too little — it was that the server kept nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { presentUIMessageStream } from '../../src/bridge/present-ui-message-stream.js'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'

/** The turn a failing SDK produces: one error event, nothing else. */
async function* failingTurn(message: string, code?: string): AsyncGenerator<AgentStreamEvent> {
  yield { type: 'error', message, ...(code === undefined ? {} : { code }) } as AgentStreamEvent
}

async function collect(
  events: AsyncIterable<AgentStreamEvent>,
): Promise<readonly Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for await (const chunk of presentUIMessageStream(events, { textId: 't' })) {
    out.push(chunk as unknown as Record<string, unknown>)
  }
  return out
}

const SECRET_ISH = 'connect ECONNREFUSED 10.0.0.4:5432 while reading /etc/theo/creds.json'

describe('a masked error is still recorded', () => {
  let logged: unknown[][]

  beforeEach(() => {
    logged = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args)
    })
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logged.push(args)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('test_the_unmasked_message_reaches_the_server_log', async () => {
    await collect(failingTurn(SECRET_ISH, 'SDK_ERROR'))

    const text = logged.map((args) => args.map(String).join(' ')).join('\n')

    expect(
      text,
      'the masked error was discarded, so a failing agent turn leaves the operator the string ' +
        '"An error occurred." and nothing else — on a serverless runtime where no debugger can be ' +
        'attached, that is the only copy of the cause and it is gone',
    ).toContain(SECRET_ISH)
  })

  it('test_the_log_names_the_code_so_it_can_be_grouped', async () => {
    // A message alone cannot be aggregated. The code is what turns "one operator saw this" into
    // "this is the failure mode of every turn on this platform".
    await collect(failingTurn(SECRET_ISH, 'SDK_ERROR'))

    expect(logged.map((args) => args.map(String).join(' ')).join('\n')).toContain('SDK_ERROR')
  })

  it('test_the_client_still_receives_only_the_mask', async () => {
    // COUNTERPROOF, and the one that matters most: the cheap way to make the case above pass is to
    // stop masking. That would send a host, a path and a filename to a browser — exactly what
    // UNMASKED_CODES exists to prevent.
    const chunks = await collect(failingTurn(SECRET_ISH, 'SDK_ERROR'))
    const wire = JSON.stringify(chunks)

    expect(wire).toContain('An error occurred.')
    expect(
      wire,
      'the raw message reached the wire; masking was removed rather than complemented',
    ).not.toContain('10.0.0.4')
    expect(wire).not.toContain('/etc/theo/creds.json')
  })

  it('test_an_allowlisted_code_is_unchanged_on_both_sides', async () => {
    // `missing_api_key` is deliberately unmasked — it is the operator's own configuration. It must
    // still reach the client verbatim, and logging it as well is not a regression.
    const chunks = await collect(failingTurn('OPENROUTER_API_KEY is not set', 'missing_api_key'))

    expect(JSON.stringify(chunks)).toContain('OPENROUTER_API_KEY is not set')
  })

  it('test_an_error_with_no_code_is_recorded_too', async () => {
    // COUNTERPROOF for the code path: `errorChunks` only emits the code data part when a code exists,
    // so a fix hung off that branch would silently drop every uncoded error — and an uncoded error is
    // the least identifiable kind, which makes the log the only thing naming it.
    await collect(failingTurn('a bare failure with no code'))

    expect(logged.map((args) => args.map(String).join(' ')).join('\n')).toContain(
      'a bare failure with no code',
    )
  })
})
