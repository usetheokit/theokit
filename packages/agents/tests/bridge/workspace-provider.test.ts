import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import 'reflect-metadata'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { delegate } from '../../src/bridge/agent-orchestrator.js'
import {
  type IsolatedWorkspace,
  type WorkspaceProvider,
  WorkspaceProviderError,
  worktreeProvider,
} from '../../src/bridge/workspace-provider.js'

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

})

const spec = { name: 'w', compiled: applyCapabilities([new ModelCapability('m')]) }
const okStream = () => ({
  async *[Symbol.asyncIterator]() {
    yield { type: 'text_delta' as const, content: 'ok' }
    yield { type: 'done' as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
  },
})

function recordingProvider(releaseError?: unknown) {
  const log: string[] = []
  const provider: WorkspaceProvider = {
    acquire(id): Promise<IsolatedWorkspace> {
      log.push(`acquire:${id.startsWith('delegate-')}`)
      return Promise.resolve({
        path: '/tmp/ws',
        release() {
          log.push('release')
          return releaseError === undefined ? Promise.resolve() : Promise.reject(releaseError)
        },
      })
    },
  }
  return { log, provider }
}

describe('delegate isolation', () => {
  it('acquires, runs, then releases on success', async () => {
    const { log, provider } = recordingProvider()
    const r = await delegate(spec, 'hi', {
      apiKey: 'k',
      isolation: provider,
      streamFactory: okStream,
    })
    expect(r.response).toBe('ok')
    expect(log).toEqual(['acquire:true', 'release'])
  })

  it('spec.isolation is used, and options.isolation wins over it', async () => {
    const a = recordingProvider()
    const b = recordingProvider()
    await delegate({ ...spec, isolation: a.provider }, 'hi', {
      apiKey: 'k',
      streamFactory: okStream,
    })
    await delegate({ ...spec, isolation: a.provider }, 'hi', {
      apiKey: 'k',
      isolation: b.provider,
      streamFactory: okStream,
    })
    expect(a.log).toEqual(['acquire:true', 'release'])
    expect(b.log).toEqual(['acquire:true', 'release'])
  })

  it('a failing cleanup does not hide the task error', async () => {
    const taskError = new Error('task failed')
    const cleanup = new WorkspaceProviderError('cleanup boom')
    const { provider } = recordingProvider(cleanup)
    const err = await delegate(spec, 'hi', {
      apiKey: 'k',
      isolation: provider,
      streamFactory: () => ({
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw taskError
        },
      }),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors).toEqual([taskError, cleanup])
  })

  it.each([Object.freeze(new Error('frozen')), 'a string'])(
    'both failures survive a non-extensible or primitive task error (%s)',
    async (taskError) => {
      const cleanup = new Error('cleanup boom')
      const { provider } = recordingProvider(cleanup)
      const err = await delegate(spec, 'hi', {
        apiKey: 'k',
        isolation: provider,
        streamFactory: () => ({
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator]() {
            throw taskError
          },
        }),
      }).catch((e: unknown) => e)
      expect((err as AggregateError).errors).toEqual([taskError, cleanup])
    },
  )
})
