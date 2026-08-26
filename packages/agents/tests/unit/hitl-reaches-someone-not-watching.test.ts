/**
 * A paused run can reach its owner off the stream (usetheokit/theokit#458).
 *
 * The framework's asynchronous promise — *the agent works and comes back when it needs your
 * approval* — held only while a client was attached. `ApprovalRequiredEvent` went into the run's own
 * event stream and nowhere else, so a caller not currently consuming that stream never learned the
 * run was waiting, and it stayed parked until someone opened the surface and looked.
 *
 * `onApprovalRequired` is the seam the issue proposes: opt-in, transport-agnostic, and NOT a
 * dependency on `@theokit/gateway` — this package must not import from it, and choosing a channel is
 * the application's call rather than the framework's. The app receives the same facts the stream
 * carries and dispatches them however it already dispatches things.
 *
 * What the tests below pin, in order of what would hurt most if it broke:
 *
 *  1. the hook fires with nobody consuming the stream — the whole point;
 *  2. a hook that throws does not take the run with it, and does not silently approve either;
 *  3. an async hook does not delay the pause it is announcing.
 */
import { describe, expect, it } from 'vitest'

import { createHitlPlugin } from '../../src/bridge/hitl-plugin.js'
import type { HumanInTheLoopOptions } from '../../src/types.js'

const GATED: HumanInTheLoopOptions = { question: 'Ship it?' }

/** The plugin's `register` hands the callback to `ctx.on`; this captures it to drive directly. */
function drive(wiring: Parameters<typeof createHitlPlugin>[0]) {
  const plugin = createHitlPlugin(wiring)
  let handler: ((c: { name: string; args: unknown }) => Promise<unknown>) | undefined
  plugin.register({
    on: (event: string, fn: (c: { name: string; args: unknown }) => Promise<unknown>) => {
      if (event === 'pre_tool_call') handler = fn
    },
  } as never)
  if (!handler) throw new Error('the plugin did not register pre_tool_call')
  return handler
}

describe('onApprovalRequired', () => {
  it('fires even though nothing is consuming the stream', async () => {
    const announced: unknown[] = []
    const run = drive({
      gated: new Map([['deploy', GATED]]),
      // Deliberately a no-op: this is a run whose stream nobody holds.
      emit: () => undefined,
      awaitApproval: () => Promise.resolve(true),
      onApprovalRequired: (req) => {
        announced.push(req)
      },
    })

    await run({ name: 'deploy', args: { env: 'prod' } })

    expect(announced).toHaveLength(1)
    const req = announced[0] as Record<string, unknown>
    // The same facts the stream carries — an app cannot route what it cannot see.
    expect(req.toolName).toBe('deploy')
    expect(req.question).toBe('Ship it?')
    expect(req.input).toEqual({ env: 'prod' })
    expect(typeof req.approvalId).toBe('string')
    expect(req.callbackUrl).toContain(String(req.approvalId))
  })

  it('is optional — a wiring without it behaves exactly as before', async () => {
    const emitted: unknown[] = []
    const run = drive({
      gated: new Map([['deploy', GATED]]),
      emit: (e) => emitted.push(e),
      awaitApproval: () => Promise.resolve(true),
    })

    await expect(run({ name: 'deploy', args: {} })).resolves.toBeUndefined()
    expect(emitted).toHaveLength(1)
  })

  it('a failing hook does not take the run down, and does not approve by accident', async () => {
    // A Slack outage must not decide whether a gated tool runs. The run still waits for the human;
    // the delivery failure is the app's to see, not the agent's to act on.
    const run = drive({
      gated: new Map([['deploy', GATED]]),
      emit: () => undefined,
      awaitApproval: () => Promise.resolve(false), // the human said no
      onApprovalRequired: () => {
        throw new Error('slack is down')
      },
    })

    const veto = (await run({ name: 'deploy', args: {} })) as { reason?: string } | undefined
    expect(veto, 'a denied approval must still veto').toBeDefined()
  })

  it('does not wait for the hook before awaiting the human', async () => {
    // Announcing must not delay the pause: an app whose dispatch is slow would otherwise hold the
    // gated tool open for the duration of an HTTP call to Slack.
    const order: string[] = []
    const run = drive({
      gated: new Map([['deploy', GATED]]),
      emit: () => undefined,
      awaitApproval: () => {
        order.push('awaited')
        return Promise.resolve(true)
      },
      onApprovalRequired: async () => {
        await new Promise((r) => setTimeout(r, 30))
        order.push('announced')
      },
    })

    await run({ name: 'deploy', args: {} })
    expect(order[0]).toBe('awaited')
  })
})
