import { describe, expect, it } from 'vitest'

import { applyCapabilities } from '../../src/capability/capability.js'
import { CheckpointCapability } from '../../src/capability/agent-capabilities.js'

/**
 * #724 — `CheckpointOptions` read as a durable-checkpoint configuration and was a signalling flag.
 *
 * Four fields declared, exactly one ever read, and that one an `=== 'filesystem'` equality deciding
 * whether a `checkpoint_saved` event is emitted. `strategy`, `maxCheckpoints` and `ttl` were read
 * NOWHERE in the monorepo; `'drizzle'` and `'redis'` were indistinguishable from `'memory'` in every
 * code path — nothing rejected them, nothing warned about them, nothing behaved differently.
 *
 * The warning was the sharpest part. It told an author that `'filesystem'` "selects the SDK's durable
 * conversation store", while the comment directly above the one read says the SDK persists EVERY
 * session to its transcript regardless. So it pushed authors toward a value that changes only whether
 * an event is emitted — and on a pod with no volume, `filesystem` is the one storage that is actually
 * unreachable. Four knobs made that look like an informed choice.
 *
 * This is the ecosystem's own rule applied to a typed API: a surface is read, or refused with a
 * reason, never accepted and ignored. For a type, the refusal is removing the field — an author
 * cannot write what does not compile.
 */
describe('the checkpoint option', () => {
  it('test_it_no_longer_claims_a_backend_it_does_not_select', () => {
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (m: unknown) => warnings.push(String(m))
    try {
      applyCapabilities([new CheckpointCapability({ resumeSignal: false })])
    } finally {
      console.warn = warn
    }

    expect(
      warnings.join('\n'),
      'the warning still sends an author to a value that selects no store',
    ).not.toMatch(/durable conversation store|for cross-request resume/)
  })

  it('test_the_signal_is_off_by_default_and_on_when_asked', () => {
    // The whole of what this option does, and the only thing it ever did: whether the resume signal
    // reaches the client. Asserted so the rename cannot quietly change the behaviour it renames.
    const off = applyCapabilities([new CheckpointCapability(undefined)])
    const on = applyCapabilities([new CheckpointCapability({ resumeSignal: true })])

    expect(off.checkpoint).toBeUndefined()
    expect(on.checkpoint).toEqual({ resumeSignal: true })
  })
})
