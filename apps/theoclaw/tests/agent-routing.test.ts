import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAgentRouter } from '../src/routing/routing-env.js'
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
    await expect(runner.run({ id: '../x', work: async () => 1 })).rejects.toThrow(/invalid task id/)
  })

  it('rejects an unsafe task id before running the work or creating a worktree or branch', async () => {
    const dirs_ = repo()
    const runner = createWorktreeRunner(dirs_)
    let ran = false
    for (const id of ['../x', 'a/../b', '-rf', '']) {
      await expect(
        runner.run({ id, work: async () => { ran = true } }),
      ).rejects.toThrow(/invalid task id/)
    }
    expect(ran).toBe(false)
    expect(existsSync(dirs_.root)).toBe(false)
    expect(execFileSync('git', ['-C', dirs_.repo, 'branch', '--list', 'task/*']).toString()).toBe('')
  })

  it('keeps a successful kept task until remove, and can keep its branch', async () => {
    const dirs_ = repo()
    const runner = createWorktreeRunner(dirs_)
    const kept = await runner.run({ id: 'k1', keep: true, work: async (w) => w })
    expect(existsSync(kept.path)).toBe(true)
    const branches = () => execFileSync('git', ['-C', dirs_.repo, 'branch', '--list', 'task/k1']).toString()
    expect(branches()).toContain('task/k1')
    await runner.remove('k1', true)
    expect(existsSync(kept.path)).toBe(false)
    expect(branches()).toContain('task/k1')
    await expect(runner.remove('../x')).rejects.toThrow(/unsafe/)
  })
})
