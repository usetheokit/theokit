import { resolveTrustPosture } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { AgentBuilder, ToolsCapability } from '../../src/index.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import { codingAgentPreset, codingAgentTools } from '../../src/presets-entry.js'
import { inspectCompiled } from '../../src/testing/inspect-compiled.js'

const posture = (trusted: boolean) =>
  resolveTrustPosture<'projectSettings'>({
    capabilities: ['projectSettings'],
    isTrusted: () => trusted,
  })
const tool = (name: string) => ({ name }) as never

describe('AgentBuilder.capability', () => {
  it('is immutable and composes with tools', () => {
    const base = AgentBuilder.create().model('m')
    const next = base.capability(new ToolsCapability([tool('a')])).tool(tool('b'))
    expect(compileAgentDefinition(base.build()).tools).toHaveLength(0)
    expect(inspectCompiled(next.build()).toolNames).toEqual(['a', 'b'])
  })

  it('checks .approval() against tools a capability registers', () => {
    const def = AgentBuilder.create()
      .model('m')
      .capability(new ToolsCapability([tool('a')]))
      .approval('a' as never, { question: 'ok?' })
      .build()
    expect(inspectCompiled(def).gatedToolNames).toEqual(['a'])
    const bad = AgentBuilder.create()
      .model('m')
      .approval('zz' as never, { question: 'x' })
      .capability(new ToolsCapability([tool('a')]))
      .build()
    expect(() => compileAgentDefinition(bad)).toThrow(/unknown tool "zz"/)
  })

  it('gates a preset by its default gate names', () => {
    const options = {
      cwd: '/tmp/proj',
      sandboxMode: 'workspace-write',
      posture: posture(true),
    } as const
    const def = AgentBuilder.create().model('m').capability(codingAgentPreset(options)).build()
    expect(inspectCompiled(def).gatedToolNames).toEqual(
      [...codingAgentTools(options).gates.keys()].sort((a, b) => a.localeCompare(b)),
    )
    expect(inspectCompiled(def).gatedToolNames).toEqual(['ApplyPatch', 'Bash', 'Edit'])
  })

  it('claudeCode import: present when trusted, absent without throwing when denied', () => {
    const make = (trusted: boolean) =>
      compileAgentDefinition(
        AgentBuilder.create()
          .model('m')
          .capability(
            codingAgentPreset({
              cwd: '/tmp/proj',
              sandboxMode: 'read-only',
              posture: posture(trusted),
              claudeCode: { import: ['skills'] },
            }),
          )
          .build(),
      )
    expect(JSON.stringify(make(true).compatSources)).toContain('claude-code')
    expect(make(false).compatSources).toBeUndefined()
  })
})
