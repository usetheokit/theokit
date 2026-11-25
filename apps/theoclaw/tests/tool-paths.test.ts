import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PluginContext } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { pathVetoPlugin } from '../src/tools/path-veto.js'
import { agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { startModelStub } from './model-stub.js'
import type { StubReply } from './model-stub.js'

const enforced = () => ({ ok: true as const, bin: '/usr/bin/bwrap' })
const quiet = { warn: () => undefined }
const CANARY = 'canary-the-veto-must-keep-this-unread'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A workspace with host tools on, canaries in both state directories and outside the tool root. */
function workspaceWithCanaries(): { readonly workspace: string; readonly settings: ToolSettings } {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  const workspace = handle.path
  mkdirSync(join(workspace, '.theokit', 'memory'), { recursive: true })
  mkdirSync(join(workspace, '.theoclaw'), { recursive: true })
  writeFileSync(join(workspace, '.theokit', 'memory', 'x'), CANARY)
  writeFileSync(join(workspace, '.theoclaw', 'sessions.json'), CANARY)
  writeFileSync(join(workspace, 'x'), CANARY)
  const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace, { detect: enforced, ...quiet })
  symlinkSync(join(workspace, 'x'), join(settings.toolRoot, 'link-out'))
  return { workspace, settings }
}

/** The pre_tool_call handler the plugin registers, called the way the SDK calls it. */
async function vetoOf(settings: ToolSettings): Promise<(name: string, args: Record<string, unknown>) => Promise<unknown>> {
  let handler: ((ctx: unknown) => unknown) | undefined
  const plugin = pathVetoPlugin(settings)
  if (plugin.kind !== 'general') throw new Error('the veto is a general plugin')
  await plugin.register({ on: (hook: string, h: (ctx: unknown) => unknown) => {
    if (hook === 'pre_tool_call') handler = h
    return () => undefined
  } } as unknown as PluginContext)
  if (handler === undefined) throw new Error('the veto registered no pre_tool_call handler')
  const registered = handler
  return async (name, args) => registered({ name, args, agentId: 'a', runId: 'r' })
}

/** Run one turn whose model calls `calls`, and return what the second request carried back as tool results. */
async function toolResultsOf(settings: ToolSettings, calls: StubReply): Promise<string> {
  const stub = await startModelStub([calls, { text: 'done' }])
  cleanups.push(() => void stub.close())
  const agent = await createTheoClawAgent(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions: agentToolOptions(settings) }))
  const run = await agent.send('go')
  await run.wait()
  await agent[Symbol.asyncDispose]()
  return JSON.stringify(stub.requests[1]?.messages ?? [])
}

const ESCAPING = (workspace: string): string[] => [
  '../x',
  join(workspace, 'x'),
  'link-out',
  '../.theokit/memory/x',
  '../.theoclaw/sessions.json',
  '../.theokit',
  'bad\u0000name',
  '',
]

describe('the state-directory veto', () => {
  it('refuses each of the 8 escaping paths before the tool runs', async () => {
    const { workspace, settings } = workspaceWithCanaries()
    const paths = ESCAPING(workspace)
    const reads = paths.map((path) => ({ name: 'read_file', args: { path } }))
    const writes = paths.map((path) => ({ name: 'write_file', args: { path, content: 'overwritten' } }))
    const results = await toolResultsOf(settings, { toolCalls: [...reads, ...writes] })
    const answers = (JSON.parse(results) as { role: string; content: string }[]).filter((m) => m.role === 'tool')
    expect(answers).toHaveLength(16)
    for (const answer of answers) expect(answer.content).toMatch(/Plugin blocked this tool call|"ok":false/)
    const veto = await vetoOf(settings)
    for (const path of paths.slice(3)) {
      expect(await veto('read_file', { path }), path).toMatchObject({ block: true })
    }
    expect(results).not.toContain(CANARY)
    expect(readFileSync(join(workspace, 'x'), 'utf8')).toBe(CANARY)
    expect(readFileSync(join(workspace, '.theokit', 'memory', 'x'), 'utf8')).toBe(CANARY)
    expect(readFileSync(join(workspace, '.theoclaw', 'sessions.json'), 'utf8')).toBe(CANARY)
    expect(existsSync(join(workspace, 'overwritten'))).toBe(false)
  })

  it('reads a file inside the tool root', async () => {
    const { settings } = workspaceWithCanaries()
    writeFileSync(join(settings.toolRoot, 'notes.txt'), 'inside-the-root-token')
    const results = await toolResultsOf(settings, { toolCalls: [{ name: 'read_file', args: { path: 'notes.txt' } }] })
    expect(results).toContain('inside-the-root-token')
  })

  it('allows ../files/notes.txt (EC-4)', async () => {
    const { settings } = workspaceWithCanaries()
    expect(await (await vetoOf(settings))('read_file', { path: '../files/notes.txt' })).toBeUndefined()
  })

  it('refuses an apply_patch whose destination enters .theoclaw', async () => {
    const { workspace, settings } = workspaceWithCanaries()
    const patch = '*** Begin Patch\n*** Add File: ../.theoclaw/planted.json\n+{}\n*** End Patch\n'
    expect(await (await vetoOf(settings))('apply_patch', { patch })).toMatchObject({ block: true })
    await toolResultsOf(settings, { toolCalls: [{ name: 'apply_patch', args: { patch } }] })
    expect(existsSync(join(workspace, '.theoclaw', 'planted.json'))).toBe(false)
  })

  it('refuses an apply_patch whose second destination enters .theoclaw (EC-3)', async () => {
    const { settings } = workspaceWithCanaries()
    const patch = [
      '*** Begin Patch',
      '*** Add File: fine.txt',
      '+ok',
      '*** Update File: other.txt',
      '*** Move to: ../.theoclaw/sessions.json',
      '*** End Patch',
      '',
    ].join('\n')
    const verdict = await (await vetoOf(settings))('apply_patch', { patch })
    expect(verdict).toMatchObject({ block: true })
    expect(String((verdict as { message: string }).message)).toContain('.theoclaw')
  })

  it('refuses a git_diff call with no path before it runs', async () => {
    const { workspace, settings } = workspaceWithCanaries()
    // A parent repository holding a modified canary, outside the tool root: an unscoped diff would show it.
    execFileSync('git', ['init', '-q', workspace])
    execFileSync('git', ['-C', workspace, 'add', 'x'])
    execFileSync('git', ['-C', workspace, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'])
    writeFileSync(join(workspace, 'x'), `${CANARY}-modified`)
    const veto = await vetoOf(settings)
    expect(await veto('git_diff', {})).toMatchObject({ block: true })
    expect(await veto('git_diff', { path: '' })).toMatchObject({ block: true })
    // The tool root is not a repository, so git_diff is not even registered: the model cannot reach git.
    const results = await toolResultsOf(settings, { toolCalls: [{ name: 'git_diff', args: {} }] })
    expect(results).not.toContain(CANARY)
  })

  it('refuses a git_diff call with a :(top) pathspec before it runs', async () => {
    const { settings } = workspaceWithCanaries()
    expect(await (await vetoOf(settings))('git_diff', { path: ':(top)x' })).toMatchObject({ block: true })
  })

  it('refuses a path that leaves a state directory only by name (..evil), a dangling link into one, and a case variant', async () => {
    const { workspace, settings } = workspaceWithCanaries()
    symlinkSync(join(workspace, '.theoclaw', 'new.json'), join(settings.toolRoot, 'dangling'))
    const veto = await vetoOf(settings)
    for (const path of ['../.theoclaw/..evil', 'dangling', 'dangling/deeper', '../.THEOCLAW/x', '../.theoclaw/']) {
      expect(await veto('write_file', { path, content: 'x' }), path).toMatchObject({ block: true })
    }
    expect(await veto('write_file', { path: '../.theoclawish/x', content: 'x' })).toBeUndefined()
  })

  it('refuses an apply_patch destination hidden after a U+2028 in its header line', async () => {
    const { settings } = workspaceWithCanaries()
    const patch = '*** Begin Patch\n*** Add File: ok\u2028/../../.theoclaw/x\n+{}\n*** End Patch\n'
    expect(await (await vetoOf(settings))('apply_patch', { patch })).toMatchObject({ block: true })
  })

  it('refuses a browser call whose absolute filename enters .theokit', async () => {
    // Review round 1 (F-dom-2, LCR0135): the browser server's file tools name their file `filename`.
    // The server resolves a relative name against its own temp directory (browser-proxy.mjs), so an
    // absolute path is the form that still reaches the workspace's state (review round 2, F-tests-10).
    const { workspace, settings } = workspaceWithCanaries()
    const veto = await vetoOf(settings)
    const call = { function: '() => 1', filename: join(workspace, '.theokit', 'settings.json') }
    expect(await veto('mcp_browser_browser_evaluate', call)).toMatchObject({ block: true })
    expect(await veto('mcp_browser_browser_evaluate', { ...call, filename: join(workspace, 'page.json') })).toBeUndefined()
  })

  it('refuses a relative browser filename into .theokit as defence in depth', async () => {
    // Harmless after the wrapper (it lands under the server's temp directory), refused all the same.
    const { settings } = workspaceWithCanaries()
    const veto = await vetoOf(settings)
    const call = { function: '() => 1', filename: '../.theokit/settings.json' }
    expect(await veto('mcp_browser_browser_evaluate', call)).toMatchObject({ block: true })
    expect(await veto('mcp_browser_browser_evaluate', { ...call, filename: 'page.json' })).toBeUndefined()
  })

  it('a handler error becomes a block, not a throw', async () => {
    const { settings } = workspaceWithCanaries()
    const hostile = { get path(): string { throw new Error('a getter that throws') } }
    expect(await (await vetoOf(settings))('read_file', hostile)).toMatchObject({ block: true })
    expect(await (await vetoOf(settings))('read_file', { path: 42 })).toMatchObject({ block: true })
    expect(await (await vetoOf(settings))('read_file', { paths: ['ok.txt', '../.theokit'] })).toMatchObject({ block: true })
  })
})
