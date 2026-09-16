/**
 * #70 — reading what a resumed session already contains.
 *
 * `readSessionMessages` published in `@theokit/sdk@5.0.0-next.4` (usetheokit/theokit-sdk#546). It is
 * reachable ONLY from the SDK: `@theokit/agents@12.1.0` does not forward it, and the one function it
 * does export for this — `readThreadHistory` — returns the raw Claude-shaped transcript rows rather
 * than the display shape. So this module is the seam, and it is deliberately thin: it exists to keep
 * the SDK import in ONE file, so the layer boundary is a thing a reader can find.
 *
 * The failure it must never have is the silent one. A session that was never written resolves to an
 * empty list, and a read that throws must not take the resume down with it — a surface that refuses
 * to switch sessions because a transcript is unreadable has turned a rendering gap into an outage.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readThreadMessages } from '../../src/session/thread-history.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-thread-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe('#70 — reading a session thread', () => {
  it('test_a_session_that_was_never_written_is_empty_not_an_error', async () => {
    await expect(readThreadMessages('never-written', cwd)).resolves.toEqual([])
  })

  it('test_a_read_that_throws_is_reported_and_does_not_propagate', async () => {
    const seen: string[] = []
    const boom = (): never => {
      throw new Error('disk on fire')
    }

    const out = await readThreadMessages('any', cwd, (m) => seen.push(m), boom)

    expect(out, 'a failed read must not become a failed resume').toEqual([])
    expect(seen.join('\n'), 'the failure was swallowed without a word').toContain('disk on fire')
  })

  it('test_what_the_reader_returns_is_passed_through_unchanged', async () => {
    // The seam adds no interpretation. Shaping for the renderer happens in the TUI, on purpose:
    // this package must not grow a dependency on how a timeline draws.
    const messages = [{ role: 'assistant' as const, text: 'hi' }]

    const out = await readThreadMessages('any', cwd, undefined, async () => messages)

    expect(out).toEqual(messages)
  })
})
