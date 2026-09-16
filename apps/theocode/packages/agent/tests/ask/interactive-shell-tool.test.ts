/**
 * B-009 — the fork is gone, and this test is why it can be.
 *
 * The tool forked the SDK's Zod schema and handler for one reason: `toErrorJson` matched
 * `InteractiveUnavailableError` before its subclass, so a session cap arrived as
 * `interactive_unavailable` with `max` and `liveSessionIds` discarded — the only fields the model
 * can act on. There was no error seam to override, so recovering them meant rebuilding the tool.
 *
 * That was fixed upstream and released as `@theokit/sdk-tools@0.26.2`. This test asserts the
 * behaviour the fork existed to provide, against the SDK's own tool — so if a future bump ever
 * regresses it, this turns red instead of the fork silently being needed again.
 */
import { describe, expect, it } from 'vitest'

import { createInteractiveShellTool } from '../../src/ask/interactive-shell-tool.js'

/** A provider whose backend refuses with a session cap, the shape `@theokit/sdk-pty` raises. */
const cappedProvider = () =>
  (() => ({
    startInteractive: () => {
      throw Object.assign(new Error('interactive session limit reached (2 live)'), {
        code: 'interactive_unavailable',
        max: 2,
        liveSessionIds: ['s-1', 's-2'],
      })
    },
    writeStdin: () => {
      throw new Error('not used')
    },
    kill: () => {},
  })) as never

async function runTool(interactive: never): Promise<Record<string, unknown>> {
  const tool = createInteractiveShellTool({ interactive })
  const handler = (tool as unknown as { handler: (i: unknown, c: unknown) => Promise<string> })
    .handler
  return JSON.parse(await handler({ command: 'bash -i' }, {})) as Record<string, unknown>
}

describe('B-009 — a session cap stays actionable through the SDK tool', () => {
  it('test_the_cap_reports_its_limit_and_the_live_sessions', async () => {
    const out = await runTool(cappedProvider())

    expect(
      out.error,
      'the session cap was flattened into interactive_unavailable — this is the regression the ' +
        'local fork existed to work around, fixed in @theokit/sdk-tools@0.26.2',
    ).toBe('interactive_session_limit')
    expect(out.max).toBe(2)
    expect(out.live_session_ids).toEqual(['s-1', 's-2'])
  })
})
