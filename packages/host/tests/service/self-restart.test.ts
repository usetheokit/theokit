import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  RESTART_EXIT_CODE,
  RestartError,
  isSupervised,
  UnsupportedPlatformError,
  restartSelf,
  runCommand,
  waitForPredecessor,
} from '../../src/service/index.js'

describe('isSupervised', () => {
  it.each([
    ['linux', { INVOCATION_ID: 'x' }, true],
    ['linux', { INVOCATION_ID: '' }, false],
    ['linux', {}, false],
    ['linux', { XPC_SERVICE_NAME: 'a' }, false],
    ['darwin', { XPC_SERVICE_NAME: 'com.x' }, true],
    ['darwin', { XPC_SERVICE_NAME: '0' }, false],
    ['darwin', { INVOCATION_ID: 'x' }, false],
    ['win32', { INVOCATION_ID: 'x', XPC_SERVICE_NAME: 'a' }, false],
  ] as const)('%s %j -> %s', (platform, env, expected) => {
    expect(isSupervised(env, platform)).toBe(expected)
  })
})

function fakeChild(pid: number | undefined) {
  return Object.assign(new EventEmitter(), { pid, unref() {} })
}

describe('restartSelf', () => {
  it('resolves the exit code 75 under a supervisor', async () => {
    await expect(
      restartSelf({ startEnv: {}, env: { INVOCATION_ID: 'x' }, platform: 'linux' }),
    ).resolves.toEqual({ kind: 'exit', code: RESTART_EXIT_CODE })
  })

  it('resolves the successor pid, with the predecessor pid in its env', async () => {
    let seen: Record<string, string | undefined> = {}
    const result = await restartSelf({
      startEnv: { A: '1' },
      env: {},
      platform: 'linux',
      spawn: (_c, _a, o) => {
        seen = o.env ?? {}
        return fakeChild(42)
      },
    })
    expect(result).toEqual({ kind: 'spawned', pid: 42 })
    expect(seen).toMatchObject({ A: '1', THEOKIT_HOST_RESTART_AFTER_PID: String(process.pid) })
  })

  it('rejects with RestartError whose cause is the error thrown by spawn', async () => {
    const cause = new Error('EAGAIN')
    const error = await restartSelf({
      startEnv: {},
      env: {},
      platform: 'linux',
      spawn: () => {
        throw cause
      },
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RestartError)
    expect((error as RestartError).cause).toBe(cause)
  })

  it('rejects with the real asynchronous spawn error as cause', async () => {
    const error = await restartSelf({
      startEnv: {},
      env: {},
      platform: 'linux',
      spawn: (_c, _a, o) => spawn('/nonexistent/x', [], o),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RestartError)
    expect((error as RestartError).cause).toBeInstanceOf(Error)
    expect(((error as RestartError).cause as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  it('refuses an unsupported platform before spawning', async () => {
    let spawned = false
    const run = () =>
      restartSelf({
        startEnv: {},
        env: {},
        platform: 'win32',
        spawn: () => {
          spawned = true
          return fakeChild(1)
        },
      })
    await expect(run()).rejects.toThrow(UnsupportedPlatformError)
    await expect(run()).rejects.toThrow(/win32/)
    expect(spawned).toBe(false)
  })
})

describe('waitForPredecessor', () => {
  it('clears the marker and returns for a missing or dead pid', async () => {
    const env: NodeJS.ProcessEnv = { THEOKIT_HOST_RESTART_AFTER_PID: '2147483646' }
    await waitForPredecessor(env)
    expect(env.THEOKIT_HOST_RESTART_AFTER_PID).toBeUndefined()
    await waitForPredecessor({})
  })

  it('gives up at the timeout for a live pid', async () => {
    const start = Date.now()
    await waitForPredecessor(
      { THEOKIT_HOST_RESTART_AFTER_PID: String(process.ppid) },
      { timeoutMs: 120 },
    )
    expect(Date.now() - start).toBeLessThan(2000)
  })
})

describe('runCommand', () => {
  it('returns 127 for a command that cannot start and the code otherwise', async () => {
    expect((await runCommand('/nonexistent/cmd-xyz', [])).code).toBe(127)
    expect((await runCommand('sh', ['-c', 'exit 3'])).code).toBe(3)
    expect(await runCommand('sh', ['-c', 'echo hi'])).toMatchObject({ code: 0, stdout: 'hi\n' })
  })
})
