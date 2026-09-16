/**
 * B-017 — the veto that keeps the agent off an unsandboxed shell, with nothing watching it.
 *
 * `withBuiltinShellVeto` is wired: `chat.ts:31` imports it and `chat.ts:245` wraps the handlers.
 * Measured 2026-08-19: no test file imported it. A regression here does not fail a build — it
 * shows up as a write that ignored `--sandbox read-only`, in the field, after the fact.
 *
 * The pass-through test asserts the previous handler's RETURN VALUE rather than that it was
 * called: a wrapper that invokes the previous handler and discards its answer would silently drop
 * every other hook's decision, and "was called" cannot see that.
 */
import { describe, expect, it, vi } from 'vitest'

import { withBuiltinShellVeto } from '../../src/hooks/veto-builtin-shell.js'

type Handlers = Parameters<typeof withBuiltinShellVeto>[0]

const call = (h: Handlers, name: string) => h.pre_tool_call?.({ name } as never)

describe('withBuiltinShellVeto', () => {
  it('blocks_the_runtime_builtin_shell', async () => {
    const previous = vi.fn(async () => undefined)

    const result = await call(
      withBuiltinShellVeto({ pre_tool_call: previous } as Handlers),
      'shell',
    )

    expect(result).toMatchObject({ block: true })
    // The reason has to tell the model WHY, or it retries the same call. Asserting the sandbox is
    // named, not the exact sentence, so rewording the message does not break the test.
    expect(String((result as { message: string }).message)).toContain('sandbox')
  })

  it('does_not_consult_the_previous_handler_for_the_shell', async () => {
    // A veto that still runs the chain first would let another handler approve, or throw, before
    // the block is reached.
    const previous = vi.fn(async () => undefined)

    await call(withBuiltinShellVeto({ pre_tool_call: previous } as Handlers), 'shell')

    expect(previous).not.toHaveBeenCalled()
  })

  it('returns_the_previous_handlers_own_decision_for_any_other_tool', async () => {
    const decision = { block: true, message: 'some other rule' }
    const previous = vi.fn(async () => decision)

    const result = await call(
      withBuiltinShellVeto({ pre_tool_call: previous } as Handlers),
      'run_shell',
    )

    expect(previous).toHaveBeenCalled()
    expect(result).toBe(decision)
  })

  it('allows_another_tool_when_there_is_no_previous_handler', async () => {
    const result = await call(withBuiltinShellVeto({} as Handlers), 'run_shell')

    expect(result).toBeUndefined()
  })

  it('keeps_the_other_handlers_it_was_given', async () => {
    // It spreads `handlers`; a mutant returning only `pre_tool_call` would drop every other hook.
    const other = vi.fn()
    const wrapped = withBuiltinShellVeto({ post_tool_call: other } as unknown as Handlers)

    expect((wrapped as unknown as { post_tool_call: unknown }).post_tool_call).toBe(other)
  })
})
