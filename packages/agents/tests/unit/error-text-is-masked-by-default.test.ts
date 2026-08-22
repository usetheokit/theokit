/**
 * The server's raw error text must not reach the browser by default (usetheokit/theokit#390).
 *
 * Every failure the framework reported to a browser carried the server's own text: a tool handler's
 * stderr verbatim in `tool-output-error.errorText`, a run failure's message verbatim in
 * `error.errorText` — including whatever a driver, an HTTP client or a filesystem call put in the
 * exception. `ai@7`, speaking the same UIMessage protocol, masks by default and says why in a
 * comment: "prevent leaking server error details to the client by default". TheoKit had no
 * equivalent, and no seam to add one.
 *
 * ## The open question this report refused to answer silently, answered
 *
 * Should a TOOL's error text mask by the same default as a RUN's? Yes, and the deciding fact is
 * that masking here does not blind the model: `presentUIMessageStream` is DOWNSTREAM of the SDK
 * loop, observing events the model has already consumed. The model's copy of a tool result travels
 * inside that loop; this generator produces the browser's copy and nothing else. So masking costs
 * the model nothing, and two different defaults for "server text reaching a browser" would be a
 * rule nobody could remember.
 *
 * ## What masking must NOT undo
 *
 * The failure `code` keeps travelling (#161 moved it into its own part precisely so consumers stop
 * matching on error text). Masking without it would force them back into the habit it removed.
 */
import { describe, expect, it } from 'vitest'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import { presentUIMessageStream } from '../../src/bridge/present-ui-message-stream.js'

/**
 * Stands in for whatever a driver put in the exception — an internal host, a query, a credential.
 *
 * Deliberately NOT shaped like a real connection string: the report's illustration was, and the
 * repository's secret-scan gate refused the commit, correctly. A fixture that trips a credential
 * detector teaches the next person to reach for `trufflehog:ignore`, and a gate people learn to
 * silence is a gate. What this test needs is a distinctive marker that must not appear on the
 * wire, which this is.
 */
const SERVER_TEXT = 'INTERNAL-DETAIL-THAT-MUST-NOT-SHIP orders-db unreachable'

async function* events(...list: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const e of list) yield e
}

async function collect(
  source: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string; onError?: (e: { message: string; code?: string }) => string },
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for await (const chunk of presentUIMessageStream(source, opts)) {
    out.push(chunk as unknown as Record<string, unknown>)
  }
  return out
}

describe('a run failure does not publish the server text (#390)', () => {
  it('masks the message by default', async () => {
    const chunks = await collect(
      events({ type: 'error', message: SERVER_TEXT } as AgentStreamEvent),
      {
        textId: 't1',
      },
    )

    const error = chunks.find((c) => c.type === 'error')
    expect(error).toBeDefined()
    expect(JSON.stringify(chunks)).not.toContain('INTERNAL-DETAIL-THAT-MUST-NOT-SHIP')
    expect(error?.errorText).toBe('An error occurred.')
  })

  it('still carries the code, so a consumer need not match on text', async () => {
    // Masking that removed the discriminator would push consumers back onto error strings — the
    // habit #161 exists to have removed.
    const chunks = await collect(
      events({ type: 'error', message: SERVER_TEXT, code: 'UPSTREAM_DOWN' } as AgentStreamEvent),
      { textId: 't2' },
    )

    expect(JSON.stringify(chunks)).toContain('UPSTREAM_DOWN')
    expect(JSON.stringify(chunks)).not.toContain('INTERNAL-DETAIL-THAT-MUST-NOT-SHIP')
  })

  it('hands the real message to onError, so a host can decide', async () => {
    const seen: string[] = []

    await collect(events({ type: 'error', message: SERVER_TEXT } as AgentStreamEvent), {
      textId: 't3',
      onError: (e) => {
        seen.push(e.message)
        return 'upstream unavailable'
      },
    })

    // The hook receives the truth; the wire receives what the hook returned.
    expect(seen).toEqual([SERVER_TEXT])
  })

  it('publishes exactly what onError returned', async () => {
    const chunks = await collect(
      events({ type: 'error', message: SERVER_TEXT } as AgentStreamEvent),
      {
        textId: 't4',
        onError: () => 'upstream unavailable',
      },
    )

    expect(chunks.find((c) => c.type === 'error')?.errorText).toBe('upstream unavailable')
  })
})
