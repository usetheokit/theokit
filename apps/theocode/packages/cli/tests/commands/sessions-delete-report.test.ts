/**
 * #125 — the delete report says what happened to EACH store, and the exit code follows.
 *
 * Both branches of the old message opened with `deleted ${target}`, and the second asserted
 * specifically about the registry — `deleted … from the session list` — which is the half nothing
 * had checked. A session left registered with no transcript was reported as a success, exit 0.
 */
import { describe, expect, it } from 'vitest'

import { deleteReport } from '../../src/commands/sessions.js'

describe('the message', () => {
  it('test_both_stores_gone_is_the_only_plain_deleted', () => {
    const r = deleteReport('exec-1', { transcriptRemoved: true, registryEntry: 'removed' })
    expect(r.message).toContain('deleted exec-1')
    expect(r.failed).toBe(false)
  })

  it('test_a_surviving_registry_entry_is_named_and_fails', () => {
    // The defect itself. It must not read as a success, and it must reach the exit code: a script
    // that deletes in a loop has no other way to learn that nothing was deleted.
    const r = deleteReport('exec-1', { transcriptRemoved: true, registryEntry: 'still-present' })
    expect(r.message.toLowerCase()).toContain('still registered')
    expect(r.message).not.toMatch(/^deleted/)
    expect(r.failed).toBe(true)
  })

  it('test_an_unverifiable_entry_says_so_rather_than_claiming_either', () => {
    // Archived sessions are excluded from the listing, so this method cannot tell. Claiming removal
    // would be the same false success; claiming failure would fail a delete that worked.
    const r = deleteReport('exec-1', { transcriptRemoved: true, registryEntry: 'unverified' })
    expect(r.message).toContain('could not be verified')
    expect(r.failed).toBe(false)
  })

  it('test_a_transcript_that_was_already_gone_is_still_reported', () => {
    // The pre-existing half, kept: a registry entry outliving its file is a normal state the GC
    // produces, and the user should know which of the two this delete actually did.
    const r = deleteReport('exec-1', { transcriptRemoved: false, registryEntry: 'removed' })
    expect(r.message).toContain('transcript')
    expect(r.failed).toBe(false)
  })
})
