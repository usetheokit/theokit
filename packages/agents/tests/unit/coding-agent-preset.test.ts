import { resolveTrustPosture } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { applyCapabilities } from '../../src/capability/index.js'
import { codingAgentPreset } from '../../src/presets-entry.js'
import { ConfigurationError } from '../../src/errors.js'

const posture = (trusted: boolean) =>
  resolveTrustPosture<'projectSettings'>({
    capabilities: ['projectSettings'],
    isTrusted: () => trusted,
  })
const interactive = { start: () => undefined } as never
const names = (d: ReturnType<typeof applyCapabilities>) => d.tools.map((t) => t.name)
const base = { cwd: '/tmp/proj', posture: posture(true) }

describe('codingAgentPreset', () => {
  it('read-only has no write or shell tool, even with an interactive backend', () => {
    const d = applyCapabilities([
      codingAgentPreset({ ...base, sandboxMode: 'read-only', interactive }),
    ])
    expect(names(d)).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'GitDiff']))
    for (const n of ['ApplyPatch', 'Edit', 'Bash', 'interactive_shell', 'write_stdin']) {
      expect(names(d)).not.toContain(n)
    }
    expect(d.hitl).toBeUndefined()
  })

  it('workspace-write has write and shell tools, gated, with the built-in shell withheld', () => {
    const d = applyCapabilities([
      codingAgentPreset({ ...base, sandboxMode: 'workspace-write', interactive }),
    ])
    expect(names(d)).toEqual(
      expect.arrayContaining(['ApplyPatch', 'Edit', 'Bash', 'interactive_shell', 'write_stdin']),
    )
    expect([...(d.hitl?.keys() ?? [])].sort((a, b) => a.localeCompare(b))).toEqual(
      ['ApplyPatch', 'Bash', 'Edit', 'interactive_shell', 'write_stdin'].sort((a, b) =>
        a.localeCompare(b),
      ),
    )
    expect(d.withheldBuiltinTools).toEqual(['shell'])
  })

  it('omits interactive tools without a backend and overrides a gate question', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        sandboxMode: 'workspace-write',
        approvals: { Bash: { question: 'Run it?' } },
      }),
    ])
    expect(names(d)).not.toContain('interactive_shell')
    expect(d.hitl?.get('Bash')?.question).toBe('Run it?')
  })

  it('refuses an approval for a tool it did not register', () => {
    expect(() =>
      codingAgentPreset({
        ...base,
        sandboxMode: 'read-only',
        approvals: { Bash: { question: 'x' } },
      }),
    ).toThrow(ConfigurationError)
  })

  const project = {
    mcpServers: { files: { command: 'node' } },
    skills: ['review'],
    subagents: { helper: { description: 'h', prompt: 'p' } },
  } as never

  it('untrusted: no project MCP, skills, subagents or project setting source', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        posture: posture(false),
        sandboxMode: 'workspace-write',
        ...(project as object),
      }),
    ])
    expect(d.mcpServers).toBeUndefined()
    expect(d.skills).toBeUndefined()
    expect(d.subagents).toBeUndefined()
    expect(d.settingSources).toEqual(['user'])
  })

  it('trusted: loads them, and hooks stay refused unless a gate approves', async () => {
    const d = applyCapabilities([
      codingAgentPreset({ ...base, sandboxMode: 'workspace-write', ...(project as object) }),
    ])
    expect(d.mcpServers).toBeDefined()
    expect(d.skills?.enabled).toEqual(['review'])
    expect(d.settingSources).toEqual(['user', 'project'])
    expect(await d.hookApproval?.approve?.({} as never)).toBe(false)
  })
})
