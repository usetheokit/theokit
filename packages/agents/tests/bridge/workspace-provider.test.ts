import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

  it('a release that failed can be retried', async () => {
    const { repo, root, git } = setup()
    const ws = await worktreeProvider(repo, root).acquire('retry')
    // a second worktree on the same branch name is impossible, so make removal fail by locking it
    git('worktree', 'lock', ws.path)
    await expect(ws.release()).rejects.toBeInstanceOf(WorkspaceProviderError)
    git('worktree', 'unlock', ws.path)
    await ws.release()
    expect(existsSync(ws.path)).toBe(false)
    expect(git('branch', '--list', 'task/retry').trim()).toBe('')
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
      onDelegationStart: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string'
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AggregateError)
    const [first, second] = (err as AggregateError).errors as unknown[]
    expect(first).toBe('plain string')
    expect(second).toBeInstanceOf(WorkspaceProviderError)
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
      onDelegationStart: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw frozen
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AggregateError)
    const [first, second] = (err as AggregateError).errors as unknown[]
    expect(first).toBe(frozen)
    expect((second as Error).message).toBe('cleanup boom')
  })

  it('SubAgentSpec.isolation is acquired, forwarded as cwd and released; the per-call provider wins', async () => {
    const { repo, root, git } = setup()
    const p = worktreeProvider(repo, root)
    const used: string[] = []
    const tracking = (tag: string) => ({
      async acquire(id: string) {
        const ws = await p.acquire(`${tag}-${id}`)
        used.push(`${tag}:${ws.path}`)
        return ws
      },
    })
    const spec = { name: 'w', compiled: { tools: [] } as never, isolation: tracking('spec') }
    h.sdkCalls.length = 0
    await delegate(spec, 'hi', { apiKey: 'k' })
    expect(used).toHaveLength(1)
    expect(used[0]).toMatch(/^spec:/)
    expect(h.sdkCalls[0]?.cwd).toBe(used[0]!.slice('spec:'.length))
    expect(existsSync(used[0]!.slice('spec:'.length))).toBe(false)

    used.length = 0
    h.sdkCalls.length = 0
    await delegate(spec, 'hi', { apiKey: 'k', isolation: tracking('call') })
    expect(used).toHaveLength(1)
    expect(used[0]).toMatch(/^call:/)
    expect(h.sdkCalls[0]?.cwd).toBe(used[0]!.slice('call:'.length))
    expect(git('branch', '--list', 'task/*').trim()).toBe('')
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

    it('refuses a listed path that goes through a symlinked directory leaving the repository', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'outside-'))
      writeFileSync(join(outside, 'secret'), 'x')
      const { repo, root } = withInclude('ignored-link/secret\n', (r) => {
        symlinkSync(outside, join(r, 'ignored-link'))
        // untracked, so the new worktree has no `ignored-link` of its own
        writeFileSync(join(r, '.git', 'info', 'exclude'), 'ignored-link\n')
      })
      await expect(worktreeProvider(repo, root).acquire('sl')).rejects.toBeInstanceOf(
        WorkspaceProviderError,
      )
      expect(existsSync(join(root, 'sl'))).toBe(false)
    })

    it('does not create directories through a destination symlink', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'outside-'))
      const { repo, root } = withInclude('a/b/f\n', (r) => {
        mkdirSync(join(r, 'a', 'b'), { recursive: true })
        writeFileSync(join(r, 'a', 'b', 'f'), 'x')
      })
      // The new worktree gets `a` as a symlink out of the workspace (post-checkout hook).
      writeFileSync(
        join(repo, '.git', 'hooks', 'post-checkout'),
        `#!/bin/sh\nrm -rf a\nln -s ${outside} a\n`,
        { mode: 0o755 },
      )
      await expect(worktreeProvider(repo, root).acquire('dd')).rejects.toBeInstanceOf(
        WorkspaceProviderError,
      )
      expect(readdirSync(outside)).toEqual([])
    })

    it('does not write through a destination file that is a symlink', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'outside-'))
      writeFileSync(join(outside, 'target'), 'orig')
      const { repo, root } = withInclude('.env\n', (r) => writeFileSync(join(r, '.env'), 'new'))
      writeFileSync(
        join(repo, '.git', 'hooks', 'post-checkout'),
        `#!/bin/sh\nln -s ${join(outside, 'target')} .env\n`,
        { mode: 0o755 },
      )
      await expect(worktreeProvider(repo, root).acquire('df')).rejects.toBeInstanceOf(
        WorkspaceProviderError,
      )
      expect(readFileSync(join(outside, 'target'), 'utf8')).toBe('orig')
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
