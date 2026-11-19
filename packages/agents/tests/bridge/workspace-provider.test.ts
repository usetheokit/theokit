import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sdkCalls: [] as Record<string, unknown>[] }))

vi.mock('../../src/bridge/sdk-adapter.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSdkAgentStream: (
    _c: unknown,
    _t: unknown,
    _k: unknown,
    overrides: Record<string, unknown>,
  ) => {
    h.sdkCalls.push(overrides)
    return () => (async function* () {})()
  },
}))

import { delegate } from '../../src/bridge/agent-orchestrator.js'
import { WorkspaceProviderError, worktreeProvider } from '../../src/bridge/workspace-provider.js'

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'wp-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test fixture uses the system git
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
    const spec = { name: 'w', compiled: { tools: [] } as never }
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
    expect((err as Error).message).toContain('task failed')
    expect((err as { cause?: unknown }).cause).toBe(taskError)
    expect((err as { cleanupError: unknown }).cleanupError).toBeInstanceOf(WorkspaceProviderError)
  })

  it('a successful delegation runs in the workspace and releases it', async () => {
    const { repo, root, git } = setup()
    const p = worktreeProvider(repo, root)
    let acquired: string | undefined
    const provider = {
      async acquire(id: string) {
        const ws = await p.acquire(id)
        acquired = ws.path
        return ws
      },
    }
    h.sdkCalls.length = 0
    await delegate({ name: 'w', compiled: { tools: [] } as never }, 'hi', {
      apiKey: 'k',
      isolation: provider,
    })
    expect(acquired).toBeDefined()
    expect(h.sdkCalls[0]?.cwd).toBe(acquired)
    expect(existsSync(acquired!)).toBe(false)
    expect(git('branch', '--list', 'task/*').trim()).toBe('')
  })

  it('a primitive task error and a failing cleanup are both reachable', async () => {
    const { repo, root } = setup()
    const p = worktreeProvider(repo, root)
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
    const err = await delegate({ name: 'w', compiled: { tools: [] } as never }, 'hi', {
      apiKey: 'k',
      isolation: provider,
      streamFactory: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string'
      },
    }).catch((e: unknown) => e)
    // `delegate` wraps what the stream throws, so the primitive is the wrapper's cause.
    expect(String(err)).toContain('plain string')
    expect((err as { cleanupError: unknown }).cleanupError).toBeInstanceOf(WorkspaceProviderError)
  })

  it('a frozen task error and a failing cleanup are both reachable', async () => {
    const { repo, root } = setup()
    const p = worktreeProvider(repo, root)
    const frozen = Object.freeze(new Error('frozen'))
    const provider = {
      async acquire(id: string) {
        const ws = await p.acquire(id)
        return {
          ...ws,
          async release() {
            await ws.release()
            throw new Error('cleanup boom')
          },
        }
      },
    }
    const err = await delegate({ name: 'w', compiled: { tools: [] } as never }, 'hi', {
      apiKey: 'k',
      isolation: provider,
      streamFactory: () => {
        throw frozen as Error
      },
    }).catch((e: unknown) => e)
    expect(String(err)).toContain('frozen')
    expect((err as { cleanupError: unknown }).cleanupError).toBeInstanceOf(Error)
  })

  describe('.worktreeinclude copier', () => {
    function withInclude(lines: string, prepare: (repo: string) => void) {
      const ctx = setup()
      writeFileSync(join(ctx.repo, '.gitignore'), 'ignored/\n.env\n')
      writeFileSync(join(ctx.repo, '.worktreeinclude'), lines)
      prepare(ctx.repo)
      ctx.git('add', '.')
      ctx.git('commit', '-qm', 'more')
      return ctx
    }

    it('refuses a nested symlink that leaves the repository', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'outside-'))
      writeFileSync(join(outside, 'secret'), 'x')
      const { repo, root } = withInclude('ignored\n', (r) => {
        mkdirSync(join(r, 'ignored'))
        symlinkSync(outside, join(r, 'ignored', 'link'))
      })
      await expect(worktreeProvider(repo, root).acquire('s')).rejects.toBeInstanceOf(
        WorkspaceProviderError,
      )
      expect(existsSync(join(root, 's'))).toBe(false)
    })

    it('copies a nested directory of plain files', async () => {
      const { repo, root } = withInclude('ignored\n', (r) => {
        mkdirSync(join(r, 'ignored'))
        writeFileSync(join(r, 'ignored', 'f'), 'ok')
      })
      const ws = await worktreeProvider(repo, root).acquire('d')
      expect(readFileSync(join(ws.path, 'ignored', 'f'), 'utf8')).toBe('ok')
      await ws.release()
    })

    it('refuses a listed symlink that points outside the repository', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'outside-'))
      writeFileSync(join(outside, 'target'), 'orig')
      const { repo, root } = withInclude('.envlink\n', (r) => {
        symlinkSync(join(outside, 'target'), join(r, '.envlink'))
      })
      await expect(worktreeProvider(repo, root).acquire('l')).rejects.toBeInstanceOf(
        WorkspaceProviderError,
      )
      expect(readFileSync(join(outside, 'target'), 'utf8')).toBe('orig')
    })
  })
})
