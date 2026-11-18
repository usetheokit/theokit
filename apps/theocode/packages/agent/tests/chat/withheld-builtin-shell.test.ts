/**
 * #1913 — the SDK builtin `shell` is withheld from the chat agent at composition, on both surfaces,
 * so it is not in the tool set sent to the SDK. The call-time veto is only a backstop.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

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
async function declaredToolNames(def: unknown): Promise<string[]> {
  const { toAgentFactory } = await import('@theokit/agents')
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
    const agent = await toAgentFactory(def as never, {
      apiKey: 'sk-test-1913-0000000000',
      approvals: POSTURE,
    })(`s-${Math.random()}`)
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

describe('#1913 — the builtin shell is not declared to the chat agent', () => {
  it('control_an_agent_that_withholds_nothing_declares_shell', async () => {
    const { AgentBuilder } = await import('@theokit/agents')
    const { z } = await import('zod')
    const def = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('openai/gpt-5')
      .system('x')
      .build()

    expect(await declaredToolNames(def)).toContain('shell')
  })

  for (const surface of ['interactive', 'headless'] as const) {
    it(`test_${surface}_surface_does_not_declare_shell_to_the_provider`, async () => {
      const { buildChatAgent } = await import('../../src/chat/chat.js')

      const def = await buildChatAgent({ surface, cwd: tmp('c1913-p-'), home: tmp('c1913-h-') })
      const names = await declaredToolNames(def)

      expect(names.length, 'precondition: the chat agent declares other tools').toBeGreaterThan(1)
      expect(names, 'shell is still declared to the model').not.toContain('shell')
    })
  }
})
