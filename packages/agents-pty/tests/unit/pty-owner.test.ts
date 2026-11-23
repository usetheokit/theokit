import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { createPtyOwner, PtyOwnerConfigError } from '../../src/index.js'
import type { OwnedPtyBackend } from '../../src/index.js'
import type { PtyInteractiveBackendOptions } from '@theokit/sdk-pty'

type Mode = 'read-only' | 'workspace-write' | 'danger-full-access'

function harness(mode: Mode, live = 2) {
  const built: Array<{ options: PtyInteractiveBackendOptions; kills: number }> = []
  const wraps: Mode[] = []
  const owner = createPtyOwner<Mode>({
    mode,
    maxSessions: 4,
    wrapFor: (m) => (command) => {
      wraps.push(m)
      return command
    },
    createBackend: (options) => {
      const record = { options, kills: 0 }
      built.push(record)
      return {
        killAll: () => {
          record.kills += 1
        },
        activeSessionCount: () => live,
      } as unknown as OwnedPtyBackend
    },
  })
  return { owner, built, wraps }
}

describe('createPtyOwner', () => {
  it('tightening the mode kills live sessions and builds a new backend', () => {
    const { owner, built } = harness('danger-full-access')
    const first = owner.backend()
    expect(owner.setMode('read-only')).toEqual({ killed: 2 })
    expect(built[0]?.kills).toBe(1)
    expect(built).toHaveLength(2)
    expect(owner.backend()).not.toBe(first)
    expect(owner.mode()).toBe('read-only')
  })

  it('loosening the mode keeps live sessions', () => {
    const { owner, built } = harness('read-only')
    const first = owner.backend()
    expect(owner.setMode('danger-full-access')).toEqual({ killed: 0 })
    expect(built[0]?.kills).toBe(0)
    expect(owner.backend()).toBe(first)
  })

  it('a new command after setMode is wrapped with the new mode', () => {
    const { owner, built, wraps } = harness('danger-full-access')
    owner.setMode('read-only')
    built[1]?.options.wrapCommand?.('bash -i', '/w')
    expect(wraps).toEqual(['read-only'])
  })

  it('rotate kills and replaces the backend; shutdown kills it', () => {
    const { owner, built } = harness('read-only')
    owner.rotate()
    expect(built[0]?.kills).toBe(1)
    expect(built).toHaveLength(2)
    owner.shutdown()
    expect(built[1]?.kills).toBe(1)
  })

  it('maxSessions 0 throws PtyOwnerConfigError', () => {
    let error: unknown
    try {
      createPtyOwner<Mode>({ mode: 'read-only', maxSessions: 0, wrapFor: () => () => null })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PtyOwnerConfigError)
    expect((error as PtyOwnerConfigError).code).toBe('pty_owner_invalid')
  })

  it('a mode outside order throws PtyOwnerConfigError', () => {
    const { owner } = harness('read-only')
    let error: unknown
    try {
      owner.setMode('bogus' as Mode)
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PtyOwnerConfigError)
    expect((error as PtyOwnerConfigError).code).toBe('pty_owner_invalid')
    expect(owner.mode()).toBe('read-only')
  })

  it('env keep/home scrubs the command through env -i', () => {
    const built: PtyInteractiveBackendOptions[] = []
    const owner = createPtyOwner<Mode>({
      mode: 'read-only',
      maxSessions: 1,
      env: { keep: ['PATH'], home: "/r'oot" },
      wrapFor: () => (command) => command,
      createBackend: (o) => {
        built.push(o)
        return { killAll: () => undefined } as unknown as OwnedPtyBackend
      },
    })
    const wrapped = built[0]?.wrapCommand?.('env', '/w') ?? ''
    expect(wrapped.startsWith('/usr/bin/env -i PATH=')).toBe(true)
    expect(wrapped).toContain(`HOME='/r'\\''oot'`)
    owner.shutdown()
  })

  it('keeps the scrub when the wrap returns null (no sandbox)', () => {
    const built: PtyInteractiveBackendOptions[] = []
    createPtyOwner<Mode>({
      mode: 'danger-full-access',
      maxSessions: 1,
      env: { keep: ['PATH'], home: '/h' },
      wrapFor: () => () => null,
      createBackend: (o) => {
        built.push(o)
        return { killAll: () => undefined } as unknown as OwnedPtyBackend
      },
    })
    expect(built[0]?.wrapCommand?.('env', '/w')).toMatch(
      /^\/usr\/bin\/env -i PATH=.* HOME='\/h' \/bin\/sh -c 'env'$/,
    )
  })

  it('without env, a null wrap stays null', () => {
    const built: PtyInteractiveBackendOptions[] = []
    createPtyOwner<Mode>({
      mode: 'read-only',
      maxSessions: 1,
      wrapFor: () => () => null,
      createBackend: (o) => {
        built.push(o)
        return { killAll: () => undefined } as unknown as OwnedPtyBackend
      },
    })
    expect(built[0]?.wrapCommand?.('env', '/w')).toBeNull()
  })

  it('a pinned cwd overrides the caller cwd', async () => {
    const calls: Array<string | undefined> = []
    const owner = createPtyOwner<Mode>({
      mode: 'read-only',
      maxSessions: 1,
      cwd: '/pinned',
      wrapFor: () => (command) => command,
      createBackend: () =>
        ({
          startInteractive: (_c: string, o?: { cwd?: string }) => {
            calls.push(o?.cwd)
            return Promise.resolve({})
          },
          killAll: () => undefined,
          activeSessionCount: () => 0,
        }) as unknown as OwnedPtyBackend,
    })
    await owner.backend().startInteractive('x', { cwd: '/elsewhere' })
    expect(calls).toEqual(['/pinned'])
    owner.shutdown()
  })

  it('a real session sees only the kept names and HOME', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pty-home-'))
    const owner = createPtyOwner<Mode>({
      mode: 'read-only',
      maxSessions: 1,
      env: { keep: ['PATH'], home },
      cwd: home,
      wrapFor: () => (command) => command,
    })
    try {
      const started = await owner.backend().startInteractive('env; pwd', { yieldMs: 1000 })
      let out = started.output
      for (
        let i = 0;
        i < 10 && started.sessionId && !out.includes(home + '\n') && !out.includes(home + '\r');
        i++
      ) {
        out += (await owner.backend().writeStdin(started.sessionId, '', { yieldMs: 250 })).output
      }
      const names = out
        .split(/\r?\n/)
        .filter((l) => /^[A-Za-z_]+=/.test(l))
        .map((l) => l.split('=')[0])
        .filter((n) => n !== 'PWD' && n !== '_' && n !== 'SHLVL' && n !== 'OLDPWD')
        .sort((a, b) => a.localeCompare(b))
      expect(names).toEqual(['HOME', 'PATH'])
    } finally {
      owner.shutdown()
      rmSync(home, { recursive: true, force: true })
    }
  })
})
