import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createSandboxBackend } from '@theokit/agents/sandbox'
import { buildRoleAgent } from '../../src/delegation/roles.js'
import { discoverRoles } from '../../src/delegation/role-discovery.js'

/**
 * #825 — a subagent's `MEMORY.md` reaches the member that runs, not only the definition on disk.
 *
 * `applySubagentMemory` IS called (`role-discovery.ts`), and it works: a role discovered with
 * `projectAllowed` carries the memory in its `prompt`. What was missing is one hop further on —
 * `roleConfigFrom` keeps `model`, `tools`, `sandbox` and drops the prompt, so the enriched definition
 * was built and discarded.
 *
 * The subagent still answered in the parity run, which is what hid this: the SDK reads
 * `.claude/agents/<name>.md` itself through `compatSources` and uses the prompt from the FILE. So the
 * member ran with the file's prompt and without the memory, and nothing reported a difference.
 *
 * Measured 2026-09-17 beside Claude Code on byte-identical configuration: asked what it knew without
 * reading any file, Claude Code returned the memory canary and described it as pre-loaded into its
 * instructions; this product returned only the definition's own.
 */
const roots: string[] = []
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots.length = 0
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theocode-mem-'))
  roots.push(dir)
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(dir, '.claude', 'agent-memory', 'auditor'), { recursive: true })
  writeFileSync(
    join(dir, '.claude', 'agents', 'auditor.md'),
    '---\nname: auditor\ndescription: a subagent that declares memory\nmemory: project\n---\n\nYou are an auditor.\n',
  )
  writeFileSync(
    join(dir, '.claude', 'agent-memory', 'auditor', 'MEMORY.md'),
    '- The canary for subagent memory is MEMORY-CANARY-825.\n',
  )
  return dir
}

describe('subagent memory', () => {
  it('test_the_discovered_definition_carries_it', async () => {
    // The half that already worked, asserted so a regression in `applySubagentMemory` is visible here
    // rather than only at the far end.
    const roles = await discoverRoles({ cwd: workspace(), projectAllowed: true })

    expect(JSON.stringify(roles.auditor)).toContain('MEMORY-CANARY-825')
  })

  it('test_the_definition_is_not_dropped_on_the_way_to_the_member', async () => {
    // Against the object the member is actually built from, not against the definition — the defect
    // was one field missing HERE, and everything upstream of it was already correct. Asserting
    // `promptForRole(def)` instead would restate what the test above proves and pass over the gap.
    const cwd = workspace()
    let seen: Record<string, unknown> = {}
    await buildRoleAgent('auditor', {
      cwd,
      posture: { allows: { subagents: true }, level: 'trusted', source: 'store' } as never,
      apiKey: 'k',
      parent: { model: 'openai/gpt-5', reasoning_effort: 'medium' },
      sandbox: createSandboxBackend({ mode: 'read-only', workDir: cwd }),
      createAgent: async (opts: unknown) => {
        seen = opts as Record<string, unknown>
        return {} as never
      },
    })

    expect(
      seen.systemPrompt,
      'the member was built without the enriched prompt — the SDK falls back to the file and the memory is lost',
    ).toContain('MEMORY-CANARY-825')
    expect(seen.systemPrompt, "the role's own instructions must survive too").toContain(
      'You are an auditor',
    )
  })
})
