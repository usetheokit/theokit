import { describe, it, expect } from 'vitest'

import { previewCommand } from '../../packages/theo/src/cli/commands/preview.js'

/**
 * B-030 — reproducing production locally was `theokit build` then
 * `theokit start`, two commands whose failure mode is silent: `start` serves
 * whatever `.theokit/` already holds, so skipping the build serves the previous
 * one and nothing says so.
 *
 * `preview` is the single command. It is deliberately not a third
 * implementation — it calls the same two, in order, and stops at the first
 * failure. The steps stay separately invocable because CI builds and serves in
 * different jobs.
 */

describe('theokit preview is one command (B-030)', () => {
  it('test_it_builds_before_it_serves', async () => {
    const order: string[] = []

    await previewCommand(
      {},
      {
        build: async () => {
          order.push('build')
        },
        start: async () => {
          order.push('start')
        },
      },
    )

    // Serving first would serve the previous build — the defect this closes.
    expect(order).toEqual(['build', 'start'])
  })

  it('test_a_failed_build_is_never_served', async () => {
    let started = false

    await expect(
      previewCommand(
        {},
        {
          build: async () => {
            throw new Error('type error in app/page.tsx')
          },
          start: async () => {
            started = true
          },
        },
      ),
    ).rejects.toThrow('type error in app/page.tsx')

    // Serving a stale build after a failed one is the two-step failure mode
    // wearing a single command's clothes.
    expect(started).toBe(false)
  })

  it('test_the_port_reaches_the_server_and_the_target_reaches_the_build', async () => {
    let seenTarget: string | undefined
    let seenPort: number | undefined

    await previewCommand(
      { port: 4321, target: 'node' },
      {
        build: async (opts) => {
          seenTarget = opts.target
        },
        start: async (opts) => {
          seenPort = opts.port
        },
      },
    )

    expect(seenTarget).toBe('node')
    expect(seenPort).toBe(4321)
  })
})
