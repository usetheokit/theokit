import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { controlAgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'

import { cloudWorkerPort, codingWorkerPort } from '../src/tools/coding-worker.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'

describe('coder delegation', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

  it('runs the task in a worktree on its own branch, commits, and keeps it listed', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'cw-'))
    dirs.push(workspace)
    const repo = join(workspace, 'files')
    const g = (...a: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
        encoding: 'utf8',
      })
    execFileSync('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'a.txt'), 'a')
    g('add', '.')
    g('commit', '-q', '-m', 'init')
    const settings = { workspace, toolRoot: repo } as unknown as ToolSettings
    let tree = ''
    const port = codingWorkerPort(
      settings,
      () => [],
      async (_tools, _task, _signal) => {
        tree = readdirTree(workspace)
        writeFileSync(join(tree, 'b.txt'), 'b')
        return { response: 'done', toolCalls: [], cost: 0, tokens: 0 }
      },
    )
    const result = await port.run('add b', {})
    expect(result.response).toContain('on branch task/coder-')
    expect(g('worktree', 'list')).toContain(tree)
    const branch = /task\/coder-[0-9a-f]+/.exec(result.response)?.[0] ?? ''
    expect(g('show', '--stat', branch)).toContain('b.txt')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(readFileSync(join(tree, 'b.txt'), 'utf8')).toBe('b')
  })

  /** Settings over a tool root that is a git repository; `env` decides host tools and the sandbox mode. */
  function settingsFor(env: Record<string, string>, repository: boolean) {
    const handle = makeHostToolsWorkspace()
    dirs.push(handle.path)
    const options = {
      detect: () => ({ ok: false as const, reason: 'test' }),
      warn: () => undefined,
    }
    const first = resolveToolSettings(env, handle.path, options as never)
    if (!repository) return first
    const git = (...a: string[]) =>
      execFileSync(
        'git',
        ['-C', first.toolRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
        { encoding: 'utf8' },
      )
    git('init', '-q')
    writeFileSync(join(first.toolRoot, 'a.txt'), 'a')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    return resolveToolSettings(env, handle.path, options as never)
  }

  const idle = (): Promise<TurnAgent> => Promise.reject(new Error('no worker expected'))
  const delegateOf = (
    settings: ReturnType<typeof settingsFor>,
    build: Parameters<typeof controlAgentToolOptions>[1],
  ) => controlAgentToolOptions(settings, build).tools.find((t) => t.name === 'delegate')

  it('offers the coder target only with host tools, writes allowed and a repository', () => {
    const offered = (env: Record<string, string>, repository: boolean) =>
      JSON.stringify(delegateOf(settingsFor(env, repository), idle)?.inputSchema).includes('coder')
    expect(offered({ THEOCLAW_HOST_TOOLS: 'on' }, true)).toBe(true)
    expect(offered({ THEOCLAW_HOST_TOOLS: 'on' }, false)).toBe(false)
    expect(offered({}, true)).toBe(false)
    expect(offered({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'read-only' }, true)).toBe(false)
  })

  it("delegate with the coder target commits the worker's file on a task branch in a listed worktree", async () => {
    const settings = settingsFor({ THEOCLAW_HOST_TOOLS: 'on' }, true)
    const worker = (
      tools: readonly { name: string; handler: (input: never) => unknown }[],
    ): TurnAgent =>
      ({
        send: async () => {
          const write = tools.find((t) => t.name === 'write_file')
          await write?.handler({ path: 'b.txt', content: 'b' } as never)
          return {
            stream: async function* () {},
            wait: async () => ({ status: 'finished', result: 'wrote b' }),
            cancel: async () => {},
          }
        },
        [Symbol.asyncDispose]: async () => {},
      }) as unknown as TurnAgent
    const tool = delegateOf(settings, async (options) => worker(options.tools as never))
    const answer = String(await tool?.handler({ agent: 'coder', task: 'add b.txt' }))
    const branch = /task\/coder-[0-9a-f]+/.exec(answer)?.[0] ?? ''
    expect(branch).not.toBe('')
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', settings.toolRoot, ...a], { encoding: 'utf8' })
    expect(git('worktree', 'list')).toContain('.theoclaw/worktrees/')
    expect(git('show', '--stat', branch)).toContain('b.txt')
    expect(existsSync(join(settings.toolRoot, 'b.txt'))).toBe(false)
  })
})

function readdirTree(workspace: string): string {
  const out = execFileSync(
    'git',
    ['-C', join(workspace, 'files'), 'worktree', 'list', '--porcelain'],
    { encoding: 'utf8' },
  )
  const paths = [...out.matchAll(/^worktree (.+)$/gm)].map((m) => m[1] ?? '')
  return paths.find((p) => p.includes('worktrees')) ?? ''
}

describe('cloud worker delegation', () => {
  it('runs on a provisioned machine, lands the commit on a task branch, and tears down', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'cl-'))
    try {
      const repo = join(workspace, 'files')
      const g = (...a: string[]) =>
        execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' })
      execFileSync('git', ['init', '-q', repo])
      writeFileSync(join(repo, 'a.txt'), 'a')
      g('add', '.')
      g('commit', '-q', '-m', 'init')
      const settings = { workspace, toolRoot: repo } as unknown as ToolSettings
      let machineDir = ''
      const port = cloudWorkerPort(
        settings,
        () => [],
        async (tools) => {
          expect(tools).toBeDefined()
          machineDir = join(workspace, '.theoclaw', 'cloud-workers')
          const checkout = readdirSync(machineDir).map((d) => join(machineDir, d, 'checkout'))[0]
          writeFileSync(join(checkout, 'b.txt'), 'b')
          return { response: 'done', toolCalls: [], cost: 0, tokens: 0 }
        },
      )
      const result = await port.run('add b', {})
      const branch = /task\/cloud-[0-9a-f]+/.exec(result.response)?.[0] ?? ''
      expect(branch).not.toBe('')
      expect(g('show', '--stat', branch)).toContain('b.txt')
      expect(existsSync(join(repo, 'b.txt'))).toBe(false)
      expect(readdirSync(machineDir)).toEqual([])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  function repoWithDevcontainer(workspace: string, post: string) {
    const repo = join(workspace, 'files')
    execFileSync('git', ['init', '-q', repo])
    mkdirSync(join(repo, '.devcontainer'))
    writeFileSync(join(repo, '.devcontainer', 'devcontainer.json'), `{ // c\n "postCreateCommand": ${JSON.stringify(post)},\n}`)
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'])
    return repo
  }
  const fakeWork = async () => ({ response: 'done', toolCalls: [], cost: 0, tokens: 0 })

  it('runs the devcontainer postCreateCommand before the agent starts', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'cl-'))
    try {
      const repo = repoWithDevcontainer(workspace, 'echo ready > marker.txt')
      const settings = { workspace, toolRoot: repo } as unknown as ToolSettings
      let seen = ''
      const port = cloudWorkerPort(settings, () => [], async () => {
        const dir = join(workspace, '.theoclaw', 'cloud-workers')
        const checkout = readdirSync(dir).map((d) => join(dir, d, 'checkout'))[0] ?? ''
        seen = readFileSync(join(checkout, 'marker.txt'), 'utf8').trim()
        return fakeWork()
      })
      const result = await port.run('x', {})
      expect(seen).toBe('ready')
      expect(result.response).toContain('devcontainer.json ran')
      expect(result.response).toContain('no changes to commit')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('does not start the agent when the recipe fails, and tears down', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'cl-'))
    try {
      const repo = repoWithDevcontainer(workspace, 'exit 3')
      const settings = { workspace, toolRoot: repo } as unknown as ToolSettings
      let started = false
      const port = cloudWorkerPort(settings, () => [], async () => {
        started = true
        return fakeWork()
      })
      await expect(port.run('x', {})).rejects.toThrow(/postCreateCommand failed/)
      expect(started).toBe(false)
      expect(readdirSync(join(workspace, '.theoclaw', 'cloud-workers'))).toEqual([])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
