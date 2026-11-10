import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAgentRouter } from '../src/routing/agent-routes.js'
import { createWorktreeRunner } from '../src/routing/task-worktree.js'

const config = {
  defaultAgent: 'main',
  agents: [
    { id: 'main', workspace: '/w/main' },
    { id: 'work', workspace: '/w/work' },
    { id: 'family', workspace: '/w/family' },
  ],
  routes: [
    { agent: 'work', platform: 'slack' },
    { agent: 'family', platform: 'slack', peer: 'mom' },
  ],
}

describe('agent routing', () => {
  it('routes a message to the configured agent by rule, most specific first', () => {
    const router = createAgentRouter(config)
    expect(router.route({ platform: 'slack', peer: 'bob' }).id).toBe('work')
    expect(router.route({ platform: 'slack', peer: 'mom' })).toEqual({ id: 'family', workspace: '/w/family' })
    expect(router.route({ platform: 'telegram', peer: 'mom' }).id).toBe('main')
  })

  it('rejects a rule that names an unconfigured agent', () => {
    expect(() => createAgentRouter({ ...config, routes: [{ agent: 'ghost', platform: 'x' }] })).toThrow(/ghost/)
  })
})

describe('delegated task worktrees', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  function repo(): { repo: string; root: string } {
    const base = mkdtempSync(join(tmpdir(), 'wt-'))
    dirs.push(base)
    const dir = join(base, 'repo')
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' })
    execFileSync('git', ['init', '-q', dir])
    writeFileSync(join(dir, 'a.txt'), 'a')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    return { repo: dir, root: join(base, 'trees') }
  }

  it('runs a delegated task in its own worktree and removes it afterwards', async () => {
    const runner = createWorktreeRunner(repo())
    const seen: string[] = []
    const work = async (path: string) => {
      seen.push(path)
      expect(existsSync(join(path, 'a.txt'))).toBe(true)
      writeFileSync(join(path, 'b.txt'), 'b')
      return path
    }
    const [one, two] = await Promise.all([
      runner.run({ id: 't1', work: (w) => work(w.path) }),
      runner.run({ id: 't2', work: (w) => work(w.path) }),
    ])
    expect(one).not.toBe(two)
    expect(existsSync(one)).toBe(false)
  })

  it('cleans up when the task fails and refuses an unsafe id', async () => {
    const runner = createWorktreeRunner(repo())
    let path = ''
    await expect(
      runner.run({ id: 'bad', work: async (w) => { path = w.path; throw new Error('boom') } }),
    ).rejects.toThrow('boom')
    expect(existsSync(path)).toBe(false)
    await expect(runner.run({ id: '../x', work: async () => 1 })).rejects.toThrow(/unsafe/)
  })
})
