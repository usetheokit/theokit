/**
 * #1913 — the SDK builtin `shell` is withheld from the chat agent at composition, on both surfaces,
 * so it is not in the tool set sent to the SDK. The call-time veto is only a backstop.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p))
  roots.push(d)
  return d
}

const POSTURE = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double' },
  reason: 'test surface',
}

/**
 * Runs `def` through the REAL SDK with `fetch` stubbed, and returns the names of the tools in the
 * request the provider receives. The SDK's own tool collection runs, so a builtin it still declares
 * shows up here.
 */
async function declaredToolNames(make: () => Promise<unknown>): Promise<string[]> {
  const bodies: { tools?: { name?: string; function?: { name?: string } }[] }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (typeof init?.body === 'string') {
      try {
        bodies.push(JSON.parse(init.body))
      } catch {
        /* not a JSON provider request */
      }
    }
    return new Response('{"error":{"message":"stubbed"}}', { status: 500 })
  }) as typeof fetch
  try {
    const agent = await make()
    try {
      const run = await (
        agent as never as { send: (m: string) => Promise<{ wait: () => Promise<unknown> }> }
      ).send('hi')
      await run.wait()
    } catch {
      /* the stub fails the turn on purpose; only the request matters */
    }
    await (agent as never as { dispose?: () => Promise<void> }).dispose?.()
  } finally {
    globalThis.fetch = realFetch
  }
  const withTools = bodies.filter((b) => Array.isArray(b.tools))
  expect(withTools.length, 'no provider request carried a tools array').toBeGreaterThan(0)
  return withTools[0]!.tools!.map((t) => t.name ?? t.function?.name ?? '')
}

/**
 * SDK 15 declares `shell` only on opt-in, and the framework has no way to opt in. So the opt-in is
 * forced at the SDK's `Agent.create`: what then keeps `shell` out is the agent's own withholding,
 * which is what #1913 is about. Without this a "not declared" check would hold either way.
 */
async function withShellOptIn<T>(run: () => Promise<T>, dropWithheld = false): Promise<T> {
  const sdk = await import('@theokit/sdk')
  const real = sdk.Agent.create.bind(sdk.Agent)
  const spy = vi.spyOn(sdk.Agent, 'create').mockImplementation(((o: Record<string, unknown>) =>
    real({
      ...o,
      builtinTools: ['shell'],
      ...(dropWithheld && { withheldBuiltinTools: [] }),
    } as never)) as never)
  try {
    return await run()
  } finally {
    spy.mockRestore()
  }
}

async function chatAgentToolNames(surface: 'interactive' | 'headless', unwithhold: boolean) {
  const { buildChatAgent } = await import('../../src/chat/chat.js')
  const { toAgentFactory } = await import('@theokit/agents')
  const built = await buildChatAgent({ surface, cwd: tmp('c1913-p-'), home: tmp('c1913-h-') })
  return withShellOptIn(
    () =>
      declaredToolNames(() =>
        toAgentFactory(built as never, { apiKey: 'sk-test-1913-0000000000', approvals: POSTURE })(
          `s-${Math.random()}`,
        ),
      ),
    unwithhold,
  )
}

describe('#1913 — the builtin shell is not declared to the chat agent', () => {
  it('control_an_agent_that_withholds_nothing_declares_shell', async () => {
    // The SDK declares `shell` only on opt-in (`builtinTools`), so the control opts in directly.
    const { Agent } = await import('@theokit/sdk')
    const names = await declaredToolNames(() =>
      Agent.create({
        apiKey: 'sk-test-1913-0000000000',
        model: { id: 'openai/gpt-5' },
        builtinTools: ['shell'],
        local: { cwd: tmp('c1913-c-') },
      } as never),
    )
    expect(names).toContain('shell')
  })

  for (const surface of ['interactive', 'headless'] as const) {
    it(`test_${surface}_surface_does_not_declare_shell_to_the_provider`, async () => {
      const names = await chatAgentToolNames(surface, false)

      expect(names.length, 'precondition: the chat agent declares other tools').toBeGreaterThan(1)
      expect(names, 'shell is still declared to the model').not.toContain('shell')
    })

    it(`test_${surface}_surface_would_declare_shell_without_the_withholding`, async () => {
      // Sensitivity: the same opt-in with the withholding dropped at the SDK does declare `shell`.
      expect(await chatAgentToolNames(surface, true)).toContain('shell')
    })
  }
})
