import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BwrapDetection } from '@theokit/agents/sandbox'
import { resolveSandboxPosture } from '@theokit/agents/sandbox'
import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { agentToolOptions, buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { advertisedTools, startModelStub } from './model-stub.js'

const sandboxCalls = vi.hoisted(() => ({ create: 0, boundSandboxes: [] as unknown[] }))

vi.mock('@theokit/agents/sandbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/agents/sandbox')>()
  return {
    ...actual,
    createSandboxBackend: (...args: Parameters<typeof actual.createSandboxBackend>) => {
      sandboxCalls.create += 1
      return actual.createSandboxBackend(...args)
    },
  }
})

vi.mock('@theokit/agents/tool-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/agents/tool-scope')>()
  return {
    ...actual,
    bindToolScope: (input: Parameters<typeof actual.bindToolScope>[0]) => {
      sandboxCalls.boundSandboxes.push(input.sandbox)
      return actual.bindToolScope(input)
    },
  }
})

const READ_ONLY = ['list_dir', 'read_file', 'todolist', 'view_image', 'web_fetch']
const HOST = ['apply_patch', 'edit_file', 'shell_exec', 'write_file']
const enforced = (): BwrapDetection => ({ ok: true, bin: '/usr/bin/bwrap' })
const notEnforced = (): BwrapDetection => ({ ok: false, reason: 'bwrap not found on PATH' })
const quiet = { warn: () => undefined }

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function tempWorkspace(): string {
  const path = mkdtempSync(join(tmpdir(), 'theoclaw-tools-'))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}

function hostWorkspace(): string {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return workspace.path
}

function makeRepository(dir: string): void {
  execFileSync('git', ['init', '-q', dir])
}

async function advertisedBy(toolOptions: ReturnType<typeof agentToolOptions>): Promise<string[]> {
  const stub = await startModelStub()
  cleanups.push(() => void stub.close())
  const agent = await createTheoClawAgent(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions }))
  const run = await agent.send('hello')
  await run.wait()
  await agent[Symbol.asyncDispose]()
  return advertisedTools(stub.requests[0])
}

function toolNamed(tools: readonly CustomTool[], name: string): CustomTool {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`no ${name} among ${tools.map((candidate) => candidate.name).join(', ')}`)
  return tool
}

/** Every `.ts` file under `dir` that builds a tool by hand: `defineTool(`, or an object literal with a `handler` and an `inputSchema`. */
function handRolledToolFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const file = join(entry.parentPath, entry.name)
    const source = readFileSync(file, 'utf8')
    if (/\bdefineTool\s*\(/.test(source) || (/\binputSchema\s*:/.test(source) && /\bhandler\s*:/.test(source))) found.push(file)
  }
  return found
}

describe('the tool catalogue', () => {
  it('the request the model stub receives advertises the five read-only tools and no shell', async () => {
    const settings = resolveToolSettings({}, tempWorkspace(), { detect: notEnforced, ...quiet })
    expect(await advertisedBy(agentToolOptions(settings))).toEqual(READ_ONLY)
  })

  it('advertises the four host-changing tools and no interactive shell when THEOCLAW_HOST_TOOLS is on', async () => {
    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, hostWorkspace(), { detect: enforced, ...quiet })
    const names = await advertisedBy(agentToolOptions(settings))
    expect(names).toEqual([...READ_ONLY, ...HOST].sort())
    expect(names).not.toContain('interactive_shell')
    expect(names).not.toContain('shell')
  })

  it('advertises git_diff only when the tool root is a repository', async () => {
    const plain = resolveToolSettings({}, hostWorkspace(), { detect: enforced, ...quiet })
    expect(buildTools(plain).map((tool) => tool.name)).not.toContain('git_diff')
    const workspace = hostWorkspace()
    makeRepository(join(workspace, 'files'))
    const repository = resolveToolSettings({}, workspace, { detect: enforced, ...quiet })
    expect(repository.gitRepository).toBe(true)
    expect(await advertisedBy(agentToolOptions(repository))).toEqual([...READ_ONLY, 'git_diff'].sort())
  })

  it('does not advertise git_diff when the sandbox is not enforced, and prints the off line', () => {
    const workspace = tempWorkspace()
    makeRepository(join(workspace, 'files'))
    const settings = resolveToolSettings({}, workspace, { detect: notEnforced, ...quiet })
    expect(buildTools(settings).map((tool) => tool.name)).not.toContain('git_diff')
    const offLine = settings.offLines.filter((line) => line.startsWith('tools: git_diff is off (sandbox not enforced: '))
    expect(offLine).toHaveLength(1)
    expect(offLine[0]).toContain('bwrap not found on PATH')
  })

  it('does not advertise git_diff when .git is a file (EC-6)', () => {
    const workspace = tempWorkspace()
    mkdirSync(join(workspace, 'files'), { mode: 0o700 })
    writeFileSync(join(workspace, 'files', '.git'), 'gitdir: /elsewhere\n')
    const settings = resolveToolSettings({}, workspace, { detect: enforced, ...quiet })
    expect(settings.gitRepository).toBe(false)
    expect(buildTools(settings).map((tool) => tool.name)).not.toContain('git_diff')
  })

  it('the agent the process builds withholds the builtin shell', () => {
    const options = agentToolOptions(resolveToolSettings({}, tempWorkspace(), { detect: notEnforced, ...quiet }))
    expect(options.withheldBuiltinTools).toEqual(['shell'])
  })

  it('every tool comes from @theokit/agents/tools', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url))
    expect(handRolledToolFiles(src)).toEqual([])
  })

  it('the source scan reports a fixture that calls defineTool', () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'fixture.ts'), "export const tool = defineTool({ name: 'x' })\n")
    writeFileSync(join(dir, 'clean.ts'), 'export const value = 1\n')
    expect(handRolledToolFiles(dir)).toEqual([join(dir, 'fixture.ts')])
  })
})

describe('the tool settings', () => {
  it('refuses THEOCLAW_HOST_TOOLS=yes', () => {
    expect(() => resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'yes' }, tempWorkspace(), { detect: notEnforced, ...quiet })).toThrow(
      new TheoClawConfigError('THEOCLAW_HOST_TOOLS must be "on" or unset, not "yes"', { variable: 'THEOCLAW_HOST_TOOLS' }),
    )
  })

  it('refuses a tool root that exists as a regular file, naming the path (EC-2)', () => {
    const workspace = tempWorkspace()
    writeFileSync(join(workspace, 'files'), 'not a directory')
    expect(() => resolveToolSettings({}, workspace, { detect: notEnforced, ...quiet })).toThrow(
      `the tool root ${join(workspace, 'files')} exists and is not a directory`,
    )
  })

  it('narrows an existing tool root with mode 0755 to 0700 and prints one line (EC-2)', () => {
    const workspace = tempWorkspace()
    mkdirSync(join(workspace, 'files'))
    chmodSync(join(workspace, 'files'), 0o755)
    const settings = resolveToolSettings({}, workspace, { detect: notEnforced, ...quiet })
    expect(statSync(join(workspace, 'files')).mode & 0o777).toBe(0o700)
    expect(settings.offLines.filter((line) => line.includes('narrowed'))).toEqual([
      `tools: narrowed the tool root ${join(workspace, 'files')} to mode 0700`,
    ])
  })

  it('creates the tool root with mode 0700', () => {
    const workspace = tempWorkspace()
    resolveToolSettings({}, workspace, { detect: notEnforced, ...quiet })
    expect(statSync(join(workspace, 'files')).mode & 0o777).toBe(0o700)
  })

  it('every agent\'s tools use the one backend built at start: two agentToolOptions calls bind the same sandbox instance, and createSandboxBackend is called once', () => {
    sandboxCalls.create = 0
    sandboxCalls.boundSandboxes.length = 0
    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, hostWorkspace(), { detect: enforced, ...quiet })
    agentToolOptions(settings)
    agentToolOptions(settings)
    expect(sandboxCalls.create).toBe(1)
    expect(sandboxCalls.boundSandboxes).toHaveLength(2)
    expect(sandboxCalls.boundSandboxes[0]).toBe(settings.sandbox)
    expect(sandboxCalls.boundSandboxes[1]).toBe(settings.sandbox)
    expect(settings.sandboxEnforced).toBe(true)
  })
})

describe('the tools at work', () => {
  it('builds a fresh todolist per agent', async () => {
    const settings = resolveToolSettings({}, tempWorkspace(), { detect: notEnforced, ...quiet })
    const first = toolNamed(agentToolOptions(settings).tools, 'todolist')
    const second = toolNamed(agentToolOptions(settings).tools, 'todolist')
    await first.handler({ action: 'add', title: 'only in the first chat' })
    expect(String(await second.handler({ action: 'list' }))).not.toContain('only in the first chat')
    expect(String(await first.handler({ action: 'list' }))).toContain('only in the first chat')
  })

  it('builds a tool list in under 50 ms at p95 over 100 builds', () => {
    const settings = resolveToolSettings({}, tempWorkspace(), { detect: notEnforced, ...quiet })
    const durations: number[] = []
    for (let build = 0; build < 100; build += 1) {
      const started = performance.now()
      agentToolOptions(settings)
      durations.push(performance.now() - started)
    }
    durations.sort((a, b) => a - b)
    expect(durations[94]).toBeLessThan(50)
  })

  it('a write_file call to ../outside.txt is refused by the tool root', async () => {
    const workspace = hostWorkspace()
    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace, { detect: enforced, ...quiet })
    const write = toolNamed(buildTools(settings), 'write_file')
    const result = await Promise.resolve(write.handler({ path: '../outside.txt', content: 'escaped' })).catch((error: unknown) => error)
    expect(existsSync(join(workspace, 'outside.txt'))).toBe(false)
    expect(JSON.parse(String(result))).toMatchObject({ ok: false, error: 'path_traversal' })
  })

  const posture = resolveSandboxPosture({ mode: 'workspace-write' })
  // read-only: git cannot even write its temp file, so the helper never starts; workspace-write:
  // the helper starts inside the sandbox and its write outside the tool root is refused.
  const confinedBy = { '': /unable to create temp-file: Read-only file system/, on: /helper-ran': Read-only file system/ }
  for (const hostTools of ['', 'on'] as const) {
    it.skipIf(!posture.enforced)(
      `a diff.external helper set in the tool root's repository config writes nothing outside the tool root when git_diff runs, host tools "${hostTools}" (needs an enforced sandbox; here: ${posture.detail})`,
      async () => {
        const workspace = hostWorkspace()
        const root = join(workspace, 'files')
        makeRepository(root)
        const canary = join(workspace, 'helper-ran')
        writeFileSync(join(root, 'helper.sh'), `#!/bin/sh\necho helper-output\ntouch ${canary}\n`, { mode: 0o755 })
        writeFileSync(join(root, 'a.txt'), 'one\n')
        execFileSync('git', ['-C', root, 'add', 'a.txt'])
        execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a'])
        execFileSync('git', ['-C', root, 'config', 'diff.external', join(root, 'helper.sh')])
        writeFileSync(join(root, 'a.txt'), 'two\n')
        // Positive control: unconfined, git runs the helper and the helper writes outside the root.
        execFileSync('git', ['-C', root, 'diff', '--', 'a.txt'])
        expect(existsSync(canary)).toBe(true)
        rmSync(canary)
        const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: hostTools }, workspace)
        const output = String(await toolNamed(buildTools(settings), 'git_diff').handler({ path: 'a.txt' }))
        expect(output).toMatch(confinedBy[hostTools])
        expect(existsSync(canary)).toBe(false)
      },
    )
  }
})

describe('makeHostToolsWorkspace', () => {
  it('makeHostToolsWorkspace refuses a base under /tmp and a base inside a git repository', () => {
    expect(() => makeHostToolsWorkspace(join(tmpdir(), 'theoclaw-base'))).toThrow(/is under \/tmp/)
    const repository = hostWorkspace()
    makeRepository(repository)
    expect(() => makeHostToolsWorkspace(join(repository, 'base'))).toThrow(/is inside a git repository/)
  })
})
