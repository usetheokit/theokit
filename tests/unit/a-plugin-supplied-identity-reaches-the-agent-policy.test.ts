import { describe, expect, it } from 'vitest'

import {
  createAgentSubjectResolver,
  createSubjectResolverFromFactory,
} from '../../packages/theo/src/server/http/resolve-agent-subject.js'

/**
 * SI-014. `resolve-agent-subject.ts:149` applies plugin decorations to the context before reading
 * the subject from it, which is how an app whose authentication lives in a PLUGIN rather than in
 * `server/context.ts` gets an identity at all.
 *
 * Nothing exercised it. The inventory judge deleted that line and 29 suites plus all 20
 * resolver-naming suites — 175 tests — stayed green. Under that mutation a plugin-authenticated
 * app resolves `null` for every caller, and `agent-access.ts` then refuses everyone from a
 * policy that is working exactly as written.
 *
 * What this does NOT assert: that a decoration LOSES to a key `context.ts` already set. That is
 * `applyDecorations`' own semantics, and asserting it against a stub runner would be asserting the
 * stub. What is asserted here is this file's contract — that the call happens, that it is handed
 * the factory's own object, and that its effect is what gets read.
 */
type Ctx = Record<string, unknown>

const runnerThatDecorates = (
  decorate: (ctx: Ctx) => void,
): { applyDecorations: (ctx: unknown) => void; seen: Ctx[] } => {
  const seen: Ctx[] = []
  return {
    applyDecorations: (ctx: unknown) => {
      seen.push(ctx as Ctx)
      decorate(ctx as Ctx)
    },
    seen,
  }
}

describe('a plugin-supplied identity reaches the agent policy', () => {
  it('test_a_baked_target_reads_a_subject_the_plugin_decorated', async () => {
    const runner = runnerThatDecorates((ctx) => {
      ctx.subject = { id: 'plugin-user' }
    })

    const resolve = createSubjectResolverFromFactory(
      // The factory produces a context with NO subject — an app whose auth is a plugin.
      () => ({ requestId: 'r-1' }),
      {},
      {},
      runner as never,
    )

    expect(await resolve(), 'the plugin-supplied identity was dropped').toEqual({
      id: 'plugin-user',
    })
    expect(
      runner.seen[0]?.requestId,
      'the decoration was handed a fresh object rather than the factory result',
    ).toBe('r-1')
  })

  it('test_the_control_the_same_factory_with_no_plugin_is_anonymous', async () => {
    // Without this, an assertion that only ever saw `{ id: 'plugin-user' }` would pass on a
    // resolver that invented a subject from anywhere.
    // No fourth argument: no plugin runner. That absence IS the control.
    const resolve = createSubjectResolverFromFactory(() => ({ requestId: 'r-1' }), {}, {})

    expect(await resolve(), 'a context with no subject resolved to someone').toBeNull()
  })

  it('test_a_scanned_target_reads_a_subject_the_plugin_decorated', async () => {
    // The other half of ADR 0014, and the same line serves it. A host WITH a filesystem loads its
    // own `context.js`; the decoration is applied on top of whatever that produced.
    const runner = runnerThatDecorates((ctx) => {
      ctx.subject = { id: 'plugin-user' }
    })

    const resolve = createAgentSubjectResolver({
      req: {} as never,
      res: {} as never,
      loadModule: (async () => ({ createContext: () => ({ requestId: 'r-2' }) })) as never,
      serverDir: '/anywhere/server',
      pluginRunner: runner as never,
    })

    expect(await resolve(), 'the plugin-supplied identity was dropped on a scanned target').toEqual(
      {
        id: 'plugin-user',
      },
    )
  })

  it('test_a_factory_subject_still_wins_its_own_slot_with_no_plugin', async () => {
    // The third leg. Cases 1 and 3 could both pass on a resolver that IGNORED the factory and read
    // only decorations; this is what says the factory path still carries an identity.
    // Again no fourth argument — the subject here can only have come from the factory.
    const resolve = createSubjectResolverFromFactory(
      () => ({ subject: { id: 'factory-user' } }),
      {},
      {},
    )

    expect(await resolve()).toEqual({ id: 'factory-user' })
  })
})
