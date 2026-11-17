/**
 * #1913 — the SDK builtin `shell` is withheld from the chat agent at composition, on both surfaces,
 * so it is not in the tool set sent to the SDK. The call-time veto is only a backstop.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }))

vi.mock('@theokit/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Agent: {
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      h.created.push(opts)
      return Promise.resolve({
        agentId: 'a1',
        send: () => Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) }),
        dispose: () => Promise.resolve(),
      })
    },
  },
}))

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

describe('#1913 — the builtin shell is not declared to the chat agent', () => {
  for (const surface of ['interactive', 'headless'] as const) {
    it(`test_${surface}_surface_withholds_shell_from_the_sdk`, async () => {
      const { buildChatAgent } = await import('../../src/chat/chat.js')
      const { toAgentFactory } = await import('@theokit/agents')
      h.created.length = 0

      const def = await buildChatAgent({ surface, cwd: tmp('c1913-p-'), home: tmp('c1913-h-') })
      await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s1')

      expect(h.created).toHaveLength(1)
      const opts = h.created[0] as { withheldBuiltinTools?: string[]; tools?: { name: string }[] }
      expect(opts.withheldBuiltinTools, 'shell is still declared to the model').toContain('shell')
      expect((opts.tools ?? []).map((t) => t.name)).not.toContain('shell')
    })
  }
})
