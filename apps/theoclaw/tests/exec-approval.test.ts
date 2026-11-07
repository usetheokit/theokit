import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced } from './tool-start-fixtures.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { controlAgentToolOptions } from '../src/tools/tool-registry.js'
import { createExecApproval, createExecApprovalStore, execApprovalPlugin } from '../src/tools/exec-approval.js'

const dir = (): string => mkdtempSync(join(tmpdir(), 'exec-approval-'))

describe('exec approval', () => {
  it('runs a saved command after a restart without a prompt, and still asks about another', async () => {
    const state = dir()
    const first = createExecApproval({ store: createExecApprovalStore(state), ask: async () => 'always' })
    expect((await first('ls -la')).allowed).toBe(true)

    const ask = vi.fn(async () => 'deny' as const)
    const second = createExecApproval({ store: createExecApprovalStore(state), ask })
    expect((await second('ls -la')).allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect((await second('ls -la /')).allowed).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('refuses on a reviewer deny before any prompt', async () => {
    const ask = vi.fn(async () => 'once' as const)
    const decide = createExecApproval({ store: createExecApprovalStore(dir()), reviewer: async () => 'deny', ask })
    expect((await decide('rm -rf /')).allowed).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks the person when the reviewer fails', async () => {
    const ask = vi.fn(async () => 'once' as const)
    const decide = createExecApproval({
      store: createExecApprovalStore(dir()),
      reviewer: async () => {
        throw new Error('model down')
      },
      ask,
    })
    expect((await decide('make')).allowed).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not remember a once answer', async () => {
    const state = dir()
    const decide = createExecApproval({ store: createExecApprovalStore(state), ask: async () => 'once' })
    await decide('make')
    expect(createExecApprovalStore(state).has('make')).toBe(false)
  })
})

describe('exec approval plugin', () => {
  type Handler = (context: unknown) => Promise<unknown> | unknown
  const handlerOf = (options: Parameters<typeof execApprovalPlugin>[0]): Handler => {
    let handler: Handler | undefined
    execApprovalPlugin(options).register({ on: (_event: string, fn: Handler) => void (handler = fn) } as never)
    if (handler === undefined) throw new Error('no handler')
    return handler
  }
  const store = (): ReturnType<typeof createExecApprovalStore> => createExecApprovalStore(dir())

  it('blocks a denied shell_exec and lets an approved one through', async () => {
    const denied = handlerOf({ store: store(), ask: async () => 'deny' })
    expect(await denied({ name: 'shell_exec', args: { command: 'make' } })).toMatchObject({ block: true })
    const allowed = handlerOf({ store: store(), ask: async () => 'once' })
    expect(await allowed({ name: 'shell_exec', args: { command: 'make' } })).toBeUndefined()
  })

  it('ignores other tools and blocks a missing command', async () => {
    const ask = vi.fn(async () => 'deny' as const)
    const handler = handlerOf({ store: store(), ask })
    expect(await handler({ name: 'read_file', args: { path: 'a' } })).toBeUndefined()
    expect(await handler({ name: 'shell_exec', args: {} })).toMatchObject({ block: true })
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses an unapproved command when nobody can be asked', async () => {
    const handler = handlerOf({ store: store() })
    expect(await handler({ name: 'shell_exec', args: { command: 'make' } })).toMatchObject({ block: true })
  })
})

describe('exec approval store', () => {
  it('names the file when it is corrupt', () => {
    const state = dir()
    writeFileSync(join(state, 'exec-approvals.json'), '{nope')
    expect(() => createExecApprovalStore(state)).toThrow(/exec-approvals\.json is not valid JSON/)
  })
})

describe('exec approval wiring', () => {
  it('puts the gate on a control agent only when host tools are on and an asker is wired', () => {
    const workspace = makeHostToolsWorkspace()
    try {
      const on = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace.path, { detect: enforced, warn: () => undefined })
      const noAgent = (): never => {
        throw new Error('not used')
      }
      const gate = { store: createExecApprovalStore(dir()), ask: async () => 'once' as const }
      const plugins = (options: ReturnType<typeof controlAgentToolOptions>): string[] => options.plugins.map((plugin) => plugin.name)
      expect(plugins(controlAgentToolOptions(on, noAgent, [], gate))).toContain('theoclaw-exec-approval')
      expect(plugins(controlAgentToolOptions(on, noAgent))).not.toContain('theoclaw-exec-approval')
      const off = resolveToolSettings({}, workspace.path, { detect: enforced, warn: () => undefined })
      expect(plugins(controlAgentToolOptions(off, noAgent, [], gate))).not.toContain('theoclaw-exec-approval')
    } finally {
      workspace.remove()
    }
  })
})
