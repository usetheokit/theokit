import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { startTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readSessionSettings } from '../src/sessions/session-settings.js'
import { capturingStream, fakeBuilders, noAgent, TELEGRAM_AND_LINE } from './composition-fixtures.js'

const WORKSPACE = '/srv/theoclaw'
const aDirectory = (): { isDirectory(): boolean } => ({ isDirectory: () => true })
const BASE = { THEOCLAW_WORKSPACE: WORKSPACE }

/** The refusal `readSessionSettings` throws for `env`, which must be a `TheoClawConfigError`. */
function refusal(env: Record<string, string | undefined>, stat = aDirectory): TheoClawConfigError {
  try {
    readSessionSettings(env, stat)
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('readSessionSettings accepted the environment')
}

describe('readSessionSettings', () => {
  it('reads the defaults when only THEOCLAW_WORKSPACE is set', () => {
    expect(readSessionSettings(BASE, aDirectory)).toEqual({
      dmScope: 'per-channel-peer',
      peerLinks: new Map(),
      workspace: WORKSPACE,
      idleMinutes: 30,
      maxOpenSessions: 200,
    })
  })

  it('refuses THEOCLAW_DM_SCOPE=per-room and names the four modes', () => {
    const error = refusal({ ...BASE, THEOCLAW_DM_SCOPE: 'per-room' })
    expect(error.variable).toBe('THEOCLAW_DM_SCOPE')
    for (const mode of ['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer']) {
      expect(error.message).toContain(mode)
    }
  })

  it('refuses per-account-channel-peer without THEOCLAW_ACCOUNT_LABEL', () => {
    const error = refusal({ ...BASE, THEOCLAW_DM_SCOPE: 'per-account-channel-peer', THEOCLAW_ACCOUNT_LABEL: '  ' })
    expect(error.variable).toBe('THEOCLAW_ACCOUNT_LABEL')
  })

  it('reads the account label under per-account-channel-peer', () => {
    const settings = readSessionSettings({ ...BASE, THEOCLAW_DM_SCOPE: 'per-account-channel-peer', THEOCLAW_ACCOUNT_LABEL: 'work' }, aDirectory)
    expect(settings.accountLabel).toBe('work')
  })

  it('refuses a THEOCLAW_PEER_LINKS pair without an equals sign', () => {
    expect(refusal({ ...BASE, THEOCLAW_PEER_LINKS: 'telegram:1' }).variable).toBe('THEOCLAW_PEER_LINKS')
  })

  it('refuses a THEOCLAW_PEER_LINKS that maps one sender twice', () => {
    expect(refusal({ ...BASE, THEOCLAW_PEER_LINKS: 'telegram:1=a,telegram:1=b' }).variable).toBe('THEOCLAW_PEER_LINKS')
  })

  it('splits a peer link on the first colon and the last equals sign', () => {
    const settings = readSessionSettings({ ...BASE, THEOCLAW_PEER_LINKS: 'matrix:@bob:example.org=bob, telegram:7=bob' }, aDirectory)
    expect(settings.peerLinks).toEqual(
      new Map([
        ['matrix:@bob:example.org', 'bob'],
        ['telegram:7', 'bob'],
      ]),
    )
  })

  it('refuses a peer name outside letters, digits and underscore', () => {
    expect(refusal({ ...BASE, THEOCLAW_PEER_LINKS: 'telegram:1=bob smith' }).variable).toBe('THEOCLAW_PEER_LINKS')
  })

  it('refuses a relative THEOCLAW_WORKSPACE', () => {
    expect(refusal({ THEOCLAW_WORKSPACE: 'rel/dir' }).variable).toBe('THEOCLAW_WORKSPACE')
  })

  it('refuses an unset THEOCLAW_WORKSPACE', () => {
    expect(refusal({}).variable).toBe('THEOCLAW_WORKSPACE')
  })

  it('refuses a THEOCLAW_WORKSPACE that is not an existing directory', () => {
    const missing = (): never => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    expect(refusal(BASE, missing).variable).toBe('THEOCLAW_WORKSPACE')
    expect(refusal(BASE, () => ({ isDirectory: () => false })).variable).toBe('THEOCLAW_WORKSPACE')
  })

  it('refuses THEOCLAW_SESSION_IDLE_MINUTES=0', () => {
    const error = refusal({ ...BASE, THEOCLAW_SESSION_IDLE_MINUTES: '0' })
    expect(error.variable).toBe('THEOCLAW_SESSION_IDLE_MINUTES')
    expect(error.message).toContain('1 to 1440')
  })

  it('refuses THEOCLAW_MAX_OPEN_SESSIONS outside 1 to 10000', () => {
    for (const value of ['0', '10001', '2.5', 'many']) {
      const error = refusal({ ...BASE, THEOCLAW_MAX_OPEN_SESSIONS: value })
      expect(error.variable).toBe('THEOCLAW_MAX_OPEN_SESSIONS')
      expect(error.message).toContain('1 to 10000')
    }
  })

  it('reads both bounds at their limits', () => {
    const settings = readSessionSettings({ ...BASE, THEOCLAW_SESSION_IDLE_MINUTES: '1440', THEOCLAW_MAX_OPEN_SESSIONS: '1' }, aDirectory)
    expect(settings.idleMinutes).toBe(1440)
    expect(settings.maxOpenSessions).toBe(1)
  })
})

describe('startTheoClaw and the session settings', () => {
  async function refusedStart(env: Record<string, string | undefined>) {
    const { builders } = fakeBuilders()
    const spy = vi.fn(builders)
    const start = startTheoClaw({
      env,
      agentFactory: noAgent,
      builders: spy,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    return { start, spy }
  }

  it('startTheoClaw refuses a bad session setting before any runner starts', async () => {
    const { start, spy } = await refusedStart({ ...TELEGRAM_AND_LINE, THEOCLAW_DM_SCOPE: 'per-room' })
    await expect(start).rejects.toMatchObject({ name: 'TheoClawConfigError', variable: 'THEOCLAW_DM_SCOPE' })
    expect(spy).toHaveBeenCalledTimes(0)
  })

  it('startTheoClaw refuses an unset THEOCLAW_WORKSPACE before any runner starts', async () => {
    const { start, spy } = await refusedStart({ ...TELEGRAM_AND_LINE, THEOCLAW_WORKSPACE: undefined })
    await expect(start).rejects.toMatchObject({ name: 'TheoClawConfigError', variable: 'THEOCLAW_WORKSPACE' })
    expect(spy).toHaveBeenCalledTimes(0)
  })
})

describe('startTheoClaw and the transcript directory', () => {
  it('leaves no signal listener behind when the transcript directory cannot be created', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-blocked-'))
    writeFileSync(join(workspace, '.theoclaw'), 'a file where the directory goes')
    const signals = new EventEmitter()
    try {
      await expect(
        startTheoClaw({
          env: { ...TELEGRAM_AND_LINE, THEOCLAW_WORKSPACE: workspace },
          agentFactory: noAgent,
          builders: fakeBuilders().builders,
          signals,
          exit: vi.fn(),
          streams: [capturingStream()],
        }),
      ).rejects.toThrow()
      expect(['SIGINT', 'SIGTERM', 'exit'].map((name) => signals.listenerCount(name))).toEqual([0, 0, 0])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
