import { describe, expect, it } from 'vitest'

import { applyCapabilities } from '../../src/capability/index.js'
import {
  assistantAgentPreset,
  assistantAgentTools,
  assistantWorkerTools,
} from '../../src/presets-entry.js'

const base = { toolRoot: '/tmp/assistant-root', webSearch: undefined }
const names = (tools: readonly { name: string }[]) => tools.map((t) => t.name)
const WRITERS = ['write_file', 'edit_file', 'apply_patch']

describe('assistantAgentTools', () => {
  it('with hostTools off registers no shell and no writer, and reports each with a reason', () => {
    const { tools, off } = assistantAgentTools({
      ...base,
      sandboxMode: 'workspace-write',
      hostTools: false,
    })
    for (const n of ['shell_exec', ...WRITERS]) {
      expect(names(tools)).not.toContain(n)
      expect(off.find((o) => o.name === n)?.reason).toMatch(/\S/)
    }
    expect(names(tools)).toEqual(
      expect.arrayContaining(['read_file', 'list_dir', 'web_fetch', 'todolist']),
    )
  })

  it('read-only with hostTools registers the shell and none of the writers', () => {
    const { tools, off } = assistantAgentTools({
      ...base,
      sandboxMode: 'read-only',
      hostTools: true,
    })
    expect(names(tools)).toContain('shell_exec')
    for (const n of WRITERS) {
      expect(names(tools)).not.toContain(n)
      expect(off.map((o) => o.name)).toContain(n)
    }
  })

  it('workspace-write with hostTools registers the writers', () => {
    const { tools } = assistantAgentTools({
      ...base,
      sandboxMode: 'workspace-write',
      hostTools: true,
    })
    expect(names(tools)).toEqual(expect.arrayContaining(['shell_exec', ...WRITERS]))
  })

  it('narrow(minimal) lists exactly the read and list tools', () => {
    const { toolset } = assistantAgentTools({
      ...base,
      sandboxMode: 'workspace-write',
      hostTools: true,
    })
    expect(names(toolset.narrow('minimal').all())).toEqual(['read_file', 'list_dir'])
    expect(names(toolset.narrow('coding').all())).toContain('shell_exec')
    expect(names(toolset.narrow('messaging').all())).not.toContain('shell_exec')
  })

  it('registers git_diff only when asked, in a repository, under an enforced sandbox', () => {
    const o = { ...base, sandboxMode: 'workspace-write' as const, hostTools: false }
    expect(names(assistantAgentTools(o).tools)).not.toContain('git_diff')
    const half = assistantAgentTools({ ...o, gitDiff: 'when-enforced', gitRepository: true })
    expect(names(half.tools)).not.toContain('git_diff')
    const full = assistantAgentTools({
      ...o,
      gitDiff: 'when-enforced',
      gitRepository: true,
      sandboxEnforced: true,
    })
    expect(names(full.tools)).toContain('git_diff')
  })

  it('profile narrows the registered tools', () => {
    const { tools } = assistantAgentTools({
      ...base,
      sandboxMode: 'read-only',
      hostTools: true,
      profile: 'minimal',
    })
    expect(names(tools)).toEqual(['read_file', 'list_dir'])
  })
})

describe('assistantWorkerTools and assistantAgentPreset', () => {
  it('a worker holds only read and web tools', () => {
    expect(
      names(assistantWorkerTools({ toolRoot: '/tmp/assistant-root', sandboxMode: 'read-only' })),
    ).toEqual(['read_file', 'list_dir', 'web_fetch'])
  })

  it('the preset contributes the tools, the off report and withholds the built-in shell', () => {
    const d = applyCapabilities([
      assistantAgentPreset({ ...base, sandboxMode: 'read-only', hostTools: false }),
    ])
    expect(names(d.tools)).toContain('read_file')
    expect(d.offTools?.map((o) => o.name)).toContain('shell_exec')
    expect(d.withheldBuiltinTools).toEqual(['shell'])
  })
})
