/**
 * M96 U1 (Phase 3) — the approval posture becomes a MANDATORY parameter of `toAgentFactory`.
 *
 * ## The defect
 *
 * `toAgentFactory` compiled the definition — including the `compiled.hitl` map that `.approvals({…})`
 * produces — and **discarded** the map. The discard was admitted in writing in the JSDoc itself
 * (*"Tools still execute; they are simply not HITL-gated here"*), while the sibling bridge
 * (`streamAgentTurnInProcess`) REFUSES for the same definition. The human-less surfaces used the
 * permissive path. Four tools executed with no policy consulted, for three releases.
 *
 * The defect is one of TYPE, not of behaviour: the "no HITL" posture was not representable as a
 * value, so it was expressed as ABSENCE — and an absence has no exhaustive `match`, appears in no log
 * and fails no test. The four variants of `ApprovalPosture` make the permissive one a NAMED value;
 * what stops existing is the omission.
 *
 * ## Why the oracle is the absent side effect (ADR D4)
 *
 * A `rejects.toThrow` passes happily on a system that returns the error AFTER executing — which is
 * the exact shape of this defect. The oracle that catches it is codex's
 * (`codex-rs/core/tests/suite/approvals.rs:1499-1504`): `Expectation::FileNotCreated`, o **disco**, e
 * not the error string. Here: a sentinel file the tool's handler creates, plus a spy executor.
 *
 * ## Why this file's dispatcher is not vacuous
 *
 * It mirrors the SDK's veto contract that `tests/integration/hitl-harness.test.ts` already documents —
 * *"a `pre_tool_call` block makes the loop inject a denial tool result and CONTINUE"*. O que impede
 * that it "proves" non-execution by never executing anything is the inverted pair:
 * `test_under_auto_approve_the_tool_runs_and_NO_request_is_emitted` runs the SAME dispatcher and sees
 * the sentinel appear. A broken dispatcher fails there before it can lie here.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalPosture } from '../../src/bridge/approval-posture.js'

const captured = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
}))

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: async (id: string, opts: Record<string, unknown>) => {
      captured.options = opts
      return {
        agentId: id,
        send: async () => ({ wait: async () => ({}) }),
        dispose: async () => {},
      }
    },
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { defineAgent } = await import('../../src/bridge/define-agent.js')
const { toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess, InProcessApprovalRequiredError } =
  await import('../../src/in-process-turn.js')

let dir: string
let sentinel: string
let executor: ReturnType<typeof vi.fn>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm96-posture-'))
  sentinel = join(dir, 'a-tool-executed')
  executor = vi.fn(async () => {
    await writeFile(sentinel, 'executed')
    return 'ok'
  })
  captured.options = undefined
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A definition with ONE gated tool, whose handler writes the sentinel to disk. */
function gatedDefinition() {
  return defineAgent({
    model: 'test',
    tools: [
      {
        name: 'run_shell',
        description: 'runs a command',
        inputSchema: { type: 'object', properties: {} },
        handler: executor as never,
      },
    ],
    approvals: { run_shell: { question: 'Run run_shell?' } },
  })
}

function installedPluginNames(): string[] {
  const plugins = captured.options?.plugins
  if (!Array.isArray(plugins)) return []
  return plugins.map((p) => String((p as { name?: unknown }).name))
}

type PreToolCallHandler = (ctx: {
  name: string
  args: Record<string, unknown>
  agentId: string
  runId: string
}) => unknown

/**
 * Mirrors the SDK's tool dispatch: runs ALL registered `pre_tool_call` hooks and only then calls the
 * executor. A veto (`{ block: true }`) stops the executor from being reached — it is literally the
 * contract `hitl-harness.test.ts` already reproduces.
 */
async function dispatchToolAsTheSdkWould(
  nome: string,
): Promise<{ blocked: boolean; message?: string }> {
  const handlers: PreToolCallHandler[] = []
  for (const plugin of (captured.options?.plugins as readonly unknown[] | undefined) ?? []) {
    ;(
      plugin as { register: (ctx: { on: (h: string, fn: PreToolCallHandler) => void }) => void }
    ).register({
      on: (hook, fn) => {
        if (hook === 'pre_tool_call') handlers.push(fn)
      },
    })
  }
  for (const manipular of handlers) {
    const veto = (await manipular({ name: nome, args: {}, agentId: 'a', runId: 'r' })) as
      | { block?: boolean; message?: string }
      | undefined
    if (veto?.block === true) return { blocked: true, message: veto.message }
  }
  await executor()
  return { blocked: false }
}

async function materialize(posturePolicy: ApprovalPosture): Promise<void> {
  await toAgentFactory(gatedDefinition() as never, { apiKey: 'k', approvals: posturePolicy })('s1')
}

describe('M96 U1 — toAgentFactory requires the approval posture', () => {
  it('test_NEGATIVE_under_auto_reject_a_gated_tool_DOES_NOT_RUN', async () => {
    await materialize({ kind: 'auto-reject', reason: 'an unattended surface' })

    const outcome = await dispatchToolAsTheSdkWould('run_shell')

    expect(outcome.blocked, 'the gated tool must be vetoed').toBe(true)
    // D4 — BOTH halves of the oracle. The error message alone would pass on a system that returns the
    // error after executing, which is the exact shape of the defect this milestone closes.
    expect(
      existsSync(sentinel),
      'the absent side effect: the disk must not have been touched',
    ).toBe(false)
    expect(executor, 'the executor must not have been reached').toHaveBeenCalledTimes(0)
    expect(outcome.message).toContain('an unattended surface')
  })

  it('test_under_auto_approve_the_tool_runs_and_NO_request_is_emitted', async () => {
    // The inverse of the inverse, in the mould of codex's `wait_for_completion_without_approval`: the
    // permissive posture is still a POSTURE, and emitting a request under it is a defect. It is also
    // the test that proves the dispatcher above EXECUTES when nobody blocks — without it, the negative
    // case would be indistinguishable from a broken harness.
    await materialize({ kind: 'auto-approve', reason: 'the sandbox confines the execution' })

    const outcome = await dispatchToolAsTheSdkWould('run_shell')

    expect(outcome.blocked).toBe(false)
    expect(existsSync(sentinel)).toBe(true)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(installedPluginNames(), 'auto-approve emits no request at all').not.toContain(
      'theokit-hitl',
    )
  })

  it('test_under_interactive_the_approval_request_IS_EMITTED_before_execution', async () => {
    // The INVERSE assertion D4 requires: fail when the request is NOT emitted. Without it, an
    // implementation that installs the plugin and never fires it would stay green in everything above.
    const order: string[] = []
    const emit = vi.fn((_event: { type: string; toolName: string }) => {
      order.push('emit')
    })
    executor.mockImplementation(async () => {
      order.push('executor')
      await writeFile(sentinel, 'executed')
      return 'ok'
    })

    await materialize({
      kind: 'interactive',
      emit,
      awaitApproval: async () => true,
    })
    await dispatchToolAsTheSdkWould('run_shell')

    expect(emit, 'the request must be emitted').toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'approval_required',
      toolName: 'run_shell',
    })
    expect(order, 'emitting AFTER executing would be the same defect under another name').toEqual([
      'emit',
      'executor',
    ])
  })

  it('test_auto_reject_uses_the_hooks_plugin_and_does_NOT_require_emit', async () => {
    // The counterproof for D9's mapping. Without it, somebody "simplifies" by requiring `emit` on all
    // four variants and three surfaces end up carrying a seam none of them uses.
    await materialize({ kind: 'auto-reject', reason: 'a probe never runs a tool' })

    const names = installedPluginNames()
    expect(names).toContain('theokit-tool-hooks')
    expect(names).not.toContain('theokit-hitl')
  })

  it('test_owned_by_surface_does_not_install_the_plugin_and_carries_the_reason', async () => {
    // D3 — the variant NAMES the ACP behaviour instead of erasing it. Installing the layer's gate
    // there would produce TWO requests for the same tool; erasing the distinction would return the
    // bridge to today's state. Naming has three consequences omission does not: it shows up in the
    // `match`, it shows up in LOGS (asserted here) and it can be counted by a gate (in the consumer).
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const antes = process.env.THEOKIT_DEBUG
    process.env.THEOKIT_DEBUG = '1'
    try {
      await materialize({ kind: 'owned-by-surface', reason: 'ACP client owns the prompt' })
    } finally {
      if (antes === undefined) delete process.env.THEOKIT_DEBUG
      else process.env.THEOKIT_DEBUG = antes
    }

    expect(installedPluginNames()).toEqual([])
    const registered = debug.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(registered, 'the bypass reason must stay readable at runtime').toContain(
      'ACP client owns the prompt',
    )
    debug.mockRestore()
  })

  it('test_an_UNGATED_tool_passes_under_any_posture', async () => {
    // Edge case: `auto-reject` is the posture of GATED tools, not a universal block. Without this
    // assertion, the safest variant would break every agent that has one free tool.
    await materialize({ kind: 'auto-reject', reason: 'no human' })

    const outcome = await dispatchToolAsTheSdkWould('read_file')

    expect(outcome.blocked).toBe(false)
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('test_an_abort_while_waiting_for_approval_DOES_NOT_RUN_the_tool', async () => {
    // The only section of this milestone where two flows run together: waiting on the resolver and
    // ending the turn. A cancellation test that only checks the promise rejection would pass on a
    // system that runs the tool and aborts afterwards — hence D4's oracle here too.
    //
    // HONEST LIMIT: `AbortSignal` propagation belongs to the SDK, not to this layer. What this test
    // pins is the property that IS this layer's — while the approval does not settle, the pause HOLDS
    // the tool. The `emit` spy proves the pause actually happened (rather than the path never being
    // reached), which is the distinction D9's seam makes writable.
    const emit = vi.fn()
    const control = new AbortController()
    await materialize({
      kind: 'interactive',
      emit,
      awaitApproval: () => new Promise(() => {}), // never settles
    })

    const dispatch = dispatchToolAsTheSdkWould('run_shell')
    const race = await Promise.race([
      dispatch.then(() => 'dispatched'),
      new Promise<string>((r) => {
        control.abort()
        setTimeout(() => r('aborted'), 20)
      }),
    ])

    expect(race, 'the dispatch must not complete while the approval is pending').toBe('aborted')
    expect(emit, 'the pause must actually have happened').toHaveBeenCalledTimes(1)
    expect(existsSync(sentinel)).toBe(false)
    expect(executor).toHaveBeenCalledTimes(0)
  })

  it('test_the_toAgentFactory_JSDoc_no_longer_declares_the_discard', async () => {
    // In the mould of `agents/m67-docs-truthfulness.test.ts`: prose describing a behaviour that has
    // been erased is the class of defect `adr-governance.md § 5` enumerates. Here the prose described
    // a REAL behaviour, and it was the prose that documented the hole.
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      new URL('../../src/bridge/sdk-adapter.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('not HITL-gated here')
  })
})

describe('M96 D2 — streamAgentTurnInProcess receives the posture ADDITIVELY', () => {
  it('test_streamAgentTurnInProcess_without_approvals_STILL_refuses', () => {
    // D2's counterproof: the in-process bridge was ALREADY fail-closed — it is the correct side of
    // the divergence M96 exists to close. An additive change that loosened the one correct bridge
    // would be this plan's most expensive regression.
    expect(() => streamAgentTurnInProcess(gatedDefinition(), 'k', { message: 'oi' })).toThrow(
      InProcessApprovalRequiredError,
    )
  })

  it('test_streamAgentTurnInProcess_under_auto_approve_runs_with_no_resolver', () => {
    // The half the additive change delivers: the permissive posture becomes EXPRESSIBLE there too,
    // rather than inexpressible on one side and nameable on the other.
    expect(() =>
      streamAgentTurnInProcess(gatedDefinition(), 'k', {
        message: 'oi',
        approvals: { kind: 'auto-approve', reason: 'the sandbox confines' },
      }),
    ).not.toThrow()
  })

  it('test_NEGATIVE_in_process_under_owned_by_surface_also_needs_no_resolver', () => {
    expect(() =>
      streamAgentTurnInProcess(gatedDefinition(), 'k', {
        message: 'oi',
        approvals: { kind: 'owned-by-surface', reason: 'the surface asks' },
      }),
    ).not.toThrow()
  })
})

describe('M96 D1 — omission stops having a valid shape (a COMPILE-time gate)', () => {
  // These cases are executed by `pnpm typecheck` (the root tsconfig includes
  // `packages/*/tests/**/*.ts`): a `@ts-expect-error` that finds NO error is itself a compile error.
  // That is what converts the discipline into a gate rather than a convention.
  it('test_NEGATIVE_omitting_approvals_fails_to_compile', () => {
    const callIt = () =>
      // @ts-expect-error — `approvals` is mandatory: the omission is the defect M96 closes.
      toAgentFactory(gatedDefinition() as never, { apiKey: 'k' })
    expect(callIt).toBeTypeOf('function')
  })

  it('test_NEGATIVE_interactive_without_emit_fails_to_compile', () => {
    // D9 — without the seam, `interactive` is not installable, and a no-op default would bring the
    // silent discard back through the back door.
    // @ts-expect-error — `emit` is mandatory on the variant that emits a request.
    const posturePolicy: ApprovalPosture = { kind: 'interactive', awaitApproval: async () => true }
    expect(posturePolicy.kind).toBe('interactive')
  })

  it('test_NEGATIVE_owned_by_surface_without_a_reason_fails_to_compile', () => {
    // A bypass with no written justification must not have a valid shape.
    // @ts-expect-error — `reason` is mandatory on the bypass variant.
    const posturePolicy: ApprovalPosture = { kind: 'owned-by-surface' }
    expect(posturePolicy.kind).toBe('owned-by-surface')
  })

  it('test_NEGATIVE_an_invented_variant_fails_to_compile', () => {
    // The union is CLOSED: the exhaustive `match` is what makes the posture appear in logs and gates.
    // @ts-expect-error — `silent-discard` is not a posture; it was today's state, unnamed.
    const posturePolicy: ApprovalPosture = { kind: 'silent-discard', reason: 'x' }
    expect(posturePolicy).toBeDefined()
  })
})
