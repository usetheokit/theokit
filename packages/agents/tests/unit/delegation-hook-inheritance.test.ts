/**
 * T3.1 — a delegated member inherits its parent's `pre_tool_call` veto.
 *
 * Without this, a squad member runs a tool the parent refused. The failure is silent and passes
 * tests: nothing throws, nothing warns, and the member's own suite is green because the member
 * never declared the gate. The only real consumer of this layer discovered it and closed it with
 * sixteen lines of its own — which means every other consumer has the hole and does not know.
 *
 * This is authority inheritance, not configuration, so the default is ON (plan D6). The escape is an
 * explicit handler map, never a boolean: `hooks: {}` and "no opinion" must not be the same value at
 * a call site that decides whether a shell runs.
 */
import { describe, expect, it, vi } from 'vitest'

import { inheritHooks } from '../../src/bridge/delegation-hooks.js'
import type { HookHandlers } from '../../src/bridge/hook-handlers.js'

/** A `pre_tool_call` context is opaque to this module — it only forwards it. */
const CTX = { toolName: 'run_shell' } as unknown as Parameters<
  NonNullable<HookHandlers['pre_tool_call']>
>[0]

describe('inheritHooks', () => {
  it('member_inherits_parent_veto', async () => {
    const parent: HookHandlers = {
      pre_tool_call: () => ({ block: true, message: 'run_shell is vetoed by the parent' }),
    }

    const effective = inheritHooks(parent, undefined)
    const decision = await effective.pre_tool_call?.(CTX)

    expect(decision?.block, 'the member ran a tool the parent refused').toBe(true)
  })

  it('parent_veto_survives_a_member_that_allows', async () => {
    // The member is not malicious — it simply has its own gate that says yes. Inheritance may only
    // TIGHTEN: a member cannot widen what the parent refused, or the gate is decorative.
    const parent: HookHandlers = { pre_tool_call: () => ({ block: true, message: 'no' }) }
    const own: HookHandlers = { pre_tool_call: () => undefined }

    const decision = await inheritHooks(parent, own).pre_tool_call?.(CTX)

    expect(decision?.block).toBe(true)
  })

  it('member_veto_applies_when_the_parent_allows', async () => {
    const parent: HookHandlers = { pre_tool_call: () => undefined }
    const own: HookHandlers = { pre_tool_call: () => ({ block: true, message: 'member says no' }) }

    const decision = await inheritHooks(parent, own).pre_tool_call?.(CTX)

    expect(decision?.block).toBe(true)
    expect(decision?.message).toContain('member says no')
  })

  it('both_allow_means_allow', async () => {
    const parent: HookHandlers = { pre_tool_call: () => undefined }
    const own: HookHandlers = { pre_tool_call: () => undefined }

    await expect(inheritHooks(parent, own).pre_tool_call?.(CTX)).resolves.toBeUndefined()
  })

  it('parent_without_hooks_does_not_synthesize_a_gate', () => {
    // A gate is never INVENTED. When neither side declared `pre_tool_call`, the member gets none —
    // otherwise every existing caller silently gains a gate it never had. (Identity of the object is
    // deliberately NOT asserted: an existing gate IS wrapped to fail closed, which is hardening.)
    const own: HookHandlers = { post_tool_call: () => undefined }

    const effective = inheritHooks(undefined, own)

    expect(effective.pre_tool_call).toBeUndefined()
    expect(effective.post_tool_call).toBe(own.post_tool_call)
  })

  it('member_without_hooks_receives_the_parents', async () => {
    const parent: HookHandlers = { pre_tool_call: () => ({ block: true, message: 'parent' }) }

    const decision = await inheritHooks(parent, undefined).pre_tool_call?.(CTX)

    expect(decision?.block).toBe(true)
  })

  it('parent_hook_that_throws_fails_closed', async () => {
    // EC-12 — an inherited gate that opens on its own error is worse than no gate: it reads as
    // protection. `error-handling.md § 2` forbids the swallow; refusing is the only safe default.
    const parent: HookHandlers = {
      pre_tool_call: () => {
        throw new Error('policy service unreachable')
      },
    }

    const decision = await inheritHooks(parent, undefined).pre_tool_call?.(CTX)

    expect(decision?.block, 'a throwing gate must refuse, not allow').toBe(true)
    expect(decision?.message).toContain('policy service unreachable')
  })

  it('fire_and_forget_events_run_on_both_sides', async () => {
    const seen: string[] = []
    const parent: HookHandlers = {
      post_tool_call: () => {
        seen.push('parent')
      },
    }
    const own: HookHandlers = {
      post_tool_call: () => {
        seen.push('member')
      },
    }

    await inheritHooks(parent, own).post_tool_call?.(
      {} as unknown as Parameters<NonNullable<HookHandlers['post_tool_call']>>[0],
    )

    expect(seen).toEqual(['parent', 'member'])
  })

  it('a_throwing_observer_does_not_stop_the_other_side', async () => {
    // Observers are fire-and-forget by contract. A broken notifier must never be why the other
    // one did not run — and must never be why the turn fails.
    const own = vi.fn()
    const parent: HookHandlers = {
      post_tool_call: () => {
        throw new Error('notifier down')
      },
    }

    await expect(
      inheritHooks(parent, { post_tool_call: own }).post_tool_call?.(
        {} as unknown as Parameters<NonNullable<HookHandlers['post_tool_call']>>[0],
      ),
    ).resolves.toBeUndefined()
    expect(own).toHaveBeenCalledOnce()
  })

  it('transforms_chain_parent_then_member', async () => {
    const parent: HookHandlers = { transform_llm_output: (out) => `${out}|parent` }
    const own: HookHandlers = { transform_llm_output: (out) => `${out}|member` }

    const folded = await inheritHooks(parent, own).transform_llm_output?.(
      'base',
      {} as unknown as Parameters<NonNullable<HookHandlers['transform_llm_output']>>[1],
    )

    expect(folded).toBe('base|parent|member')
  })

  it('nested_inheritance_is_transitive', async () => {
    // A member that delegates further must carry the grandparent's veto, or the hole reopens one
    // level down — where nobody is looking.
    const grandparent: HookHandlers = { pre_tool_call: () => ({ block: true, message: 'gp' }) }
    const parent = inheritHooks(grandparent, { pre_tool_call: () => undefined })
    const child = inheritHooks(parent, { pre_tool_call: () => undefined })

    expect((await child.pre_tool_call?.(CTX))?.block).toBe(true)
  })
})
