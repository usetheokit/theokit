import { resolveTrustPosture } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { declareAgentShape, applyCapabilities } from '../../src/capability/index.js'
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

  const extra = (name: string) => ({ name }) as never

  it('registers caller web and delegation tools with default gates', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        sandboxMode: 'workspace-write',
        webFetch: extra('web_fetch'),
        webSearch: extra('web_search'),
        delegateToTeam: extra('delegate_to_team'),
      }),
    ])
    expect(names(d)).toEqual(
      expect.arrayContaining(['web_fetch', 'web_search', 'delegate_to_team']),
    )
    expect(d.hitl?.has('web_fetch')).toBe(true)
    expect(d.hitl?.has('delegate_to_team')).toBe(true)
  })

  it('read-only keeps web tools but drops delegation, and says why', () => {
    const shape = declareAgentShape('a', [
      codingAgentPreset({
        ...base,
        sandboxMode: 'read-only',
        webFetch: extra('web_fetch'),
        delegateToTeam: extra('delegate_to_team'),
      }),
    ])
    const n = shape.tools.map((t) => t.name)
    expect(n).toContain('web_fetch')
    expect(n).not.toContain('delegate_to_team')
    expect(shape.offTools?.find((o) => o.name === 'delegate_to_team')?.reason).toMatch(/no writes/)
    expect(shape.offTools?.map((o) => o.name)).toContain('Bash')
  })

  it('reports interactive tools as off without a backend', () => {
    const shape = declareAgentShape('a', [
      codingAgentPreset({ ...base, sandboxMode: 'workspace-write' }),
    ])
    expect(shape.offTools).toEqual([
      { name: 'interactive_shell', reason: expect.stringMatching(/interactive backend/) },
      { name: 'write_stdin', reason: expect.stringMatching(/interactive backend/) },
    ])
  })

  it('accepts writeRoot, allowAbsolute and defaultTimeoutMs', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        sandboxMode: 'danger-full-access',
        writeRoot: '/',
        allowAbsolute: true,
        defaultTimeoutMs: 5000,
      }),
    ])
    expect(names(d)).toEqual(expect.arrayContaining(['Read', 'ApplyPatch', 'Edit', 'Bash']))
  })
})
