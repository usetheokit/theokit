import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runWebMiddleware } from '../../packages/theo/src/server/http/web-middleware-runner.js'
import type { WebMiddleware } from '../../packages/theo/src/server/http/web-middleware-runner.js'

/**
 * B-242. `web-middleware-runner.ts` declares four variables inside `runFrom` — `invocations`,
 * `rejections`, `frameSettled`, `yieldedInvocation` — and a comment beside them calls their
 * per-frame-ness the risk. B-219 measured that all four could be hoisted to shared scope with the
 * whole suite still green, which left two readings and no way to tell them apart: either a case
 * existed that nobody had constructed, or the property had no observable consequence and the
 * comment was an unverified claim sitting next to the code it described.
 *
 * It is the first reading. `runFrom` is RECURSIVE — frame N's `next()` creates frame N+1 — so a
 * chain of three middlewares is three frames, and `invocations` shared between them is one list
 * holding everybody's calls. The counter at `report()` reads `invocations.length > 1` to warn that
 * a middleware called `next()` twice. Shared, a three-middleware chain where each calls it ONCE
 * counts three and warns about a defect nobody committed.
 *
 * That is the worst shape a warning can take: it fires on correct code, so the next reader learns
 * to ignore it, and the real double-call it exists to catch arrives in a channel that has already
 * cried wolf.
 */
function captureWarnings(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  return { lines, restore: () => (console.warn = original) }
}

/** A middleware that calls `next()` exactly once and yields what it returns. */
function passthrough(): WebMiddleware {
  return async (_request, _context, next) => next()
}

describe('a frame counts only its own invocations (B-242)', () => {
  const pristineWarn = console.warn

  beforeEach(() => {
    /* captured per test below; this pair is the net the file next door earned */
  })

  afterEach(() => {
    console.warn = pristineWarn
  })

  it('test_three_frames_each_calling_next_once_warn_about_nothing', async () => {
    const { lines } = captureWarnings()

    const response = await runWebMiddleware(
      new Request('http://x/'),
      [passthrough(), passthrough(), passthrough()],
      {},
      async () => new Response('ok'),
    )

    expect(await response?.text()).toBe('ok')
    expect(
      lines.filter((l) => l.includes('called next()')),
      'three frames calling next() once each were reported as one frame calling it three times — ' +
        'the counter is reading a list that is not its own',
    ).toEqual([])
  })

  it('test_an_inner_frames_discarded_rejection_is_reported_by_that_frame', async () => {
    // The case for `yieldedInvocation`, which `reportOne` compares against by identity to decide
    // whether a rejection reached a client. Shared between frames, an outer frame's yielded
    // promise can make an inner frame's genuinely-unreported failure look like one that WAS
    // yielded — and that direction is a false NEGATIVE: the failure reaching no client is exactly
    // what the warning exists to say.
    const { lines } = captureWarnings()

    const outer: WebMiddleware = async (_request, _context, next) => next()
    let downstreamHits = 0
    const inner: WebMiddleware = async (_request, _context, next) => {
      const discarded = next()
      void discarded.catch(() => {
        /* the frame owns it; this only keeps the probe itself from being the unhandled one */
      })
      return next()
    }

    const response = await runWebMiddleware(
      new Request('http://x/'),
      [outer, inner],
      {},
      async () => {
        downstreamHits += 1
        if (downstreamHits === 1) throw new Error('first downstream blew up')
        return new Response('ok')
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(response?.status).toBe(200)
    expect(
      lines.filter((l) => l.includes('reached no client')),
      'the inner frame discarded a rejecting invocation and nobody said so',
    ).toHaveLength(1)
  })

  it('test_one_frame_calling_next_twice_is_still_warned_about', async () => {
    // The control, and the reason the test above is not simply "delete the warning". Without it a
    // shared list and a deleted counter look identical from here: both stop warning.
    const { lines } = captureWarnings()

    const twice: WebMiddleware = async (_request, _context, next) => {
      void next()
      return next()
    }

    await runWebMiddleware(new Request('http://x/'), [twice], {}, async () => new Response('ok'))

    expect(
      lines.filter((l) => l.includes('called next() 2 times')),
      'a genuine double call stopped being reported',
    ).toHaveLength(1)
  })
})
