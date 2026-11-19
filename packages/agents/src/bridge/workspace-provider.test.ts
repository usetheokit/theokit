import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { delegate } from './agent-orchestrator.js'
import { WorkspaceProviderError, worktreeProvider } from './workspace-provider.js'

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'wp-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  writeFileSync(join(repo, 'a.txt'), 'a')
  git('add', '.')
  git('commit', '-qm', 'init')
  return { repo, root: join(base, 'wt'), git }
}

describe('worktreeProvider', () => {
  it('two concurrent tasks get two worktrees on two branches', async () => {
    const { repo, root, git } = setup()
    const p = worktreeProvider(repo, root)
    const [a, b] = await Promise.all([p.acquire('one'), p.acquire('two')])
    expect(a.path).not.toBe(b.path)
    expect([a.branch, b.branch]).toEqual(['task/one', 'task/two'])
    expect(git('branch', '--list', 'task/*')).toContain('task/two')
    await Promise.all([a.release(), b.release()])
    expect(existsSync(a.path)).toBe(false)
    expect(git('branch', '--list', 'task/*').trim()).toBe('')
  })

  it.each(['..', '../x', '.hidden', 'a/..b', ''])(
    'a task id with .. or a leading dot is refused with WorkspaceProviderError (%s)',
    async (id) => {
      const { repo, root } = setup()
      await expect(worktreeProvider(repo, root).acquire(id)).rejects.toBeInstanceOf(
        WorkspaceProviderError,
      )
    },
  )

  it('release keep true leaves the worktree and branch', async () => {
    const { repo, root, git } = setup()
    const ws = await worktreeProvider(repo, root).acquire('k')
    await ws.release({ keep: true })
    expect(existsSync(ws.path)).toBe(true)
    expect(git('branch', '--list', 'task/k')).toContain('task/k')
  })

  it('a failing cleanup does not hide the task error', async () => {
    const { repo, root } = setup()
    const p = worktreeProvider(repo, root)
    const taskError = new Error('task failed')
    const spec = { name: 'w', compiled: {} as never }
    const provider = {
      async acquire(id: string) {
        const ws = await p.acquire(id)
        return {
          ...ws,
          async release() {
            await ws.release()
            throw new WorkspaceProviderError('cleanup boom')
          },
        }
      },
    }
    const err = await delegate(spec, 'hi', {
      apiKey: 'k',
      isolation: provider,
      streamFactory: () => {
        throw taskError
      },
    }).catch((e: unknown) => e)
    expect(err).toBe(taskError)
    expect((err as { cleanupError: unknown }).cleanupError).toBeInstanceOf(WorkspaceProviderError)
  })
})
