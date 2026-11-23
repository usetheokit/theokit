import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ServiceCommandError, serviceBackend, type Runner } from '../../src/service/index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'host-logs-'))
  dirs.push(d)
  return d
}

describe('service logs', () => {
  it('queries the user journal on systemd', async () => {
    const calls: string[] = []
    const runner: Runner = async (c, args) => {
      calls.push([c, ...args].join(' '))
      return { code: 0, stdout: 'a\nb\n', stderr: '' }
    }
    const out = await serviceBackend('linux', { runner }).logs('my-agent', { lines: 5 })
    expect(out).toBe('a\nb\n')
    expect(calls).toEqual(['journalctl --user -u my-agent.service -n 5 --no-pager -o cat'])
  })

  it('throws when journalctl fails', async () => {
    const runner: Runner = async () => ({ code: 1, stdout: '', stderr: 'nope' })
    await expect(serviceBackend('linux', { runner }).logs('x')).rejects.toBeInstanceOf(
      ServiceCommandError,
    )
  })

  it('returns the tail of the launchd log file install configured', async () => {
    const homeDir = tmp()
    const logFile = join(homeDir, 'logs', 'a.log')
    const runner: Runner = async () => ({ code: 0, stdout: '', stderr: '' })
    const backend = serviceBackend('darwin', { homeDir, runner, logFile, uid: 501 })
    await backend.install({ label: 'my-agent', command: '/usr/bin/node', workingDirectory: '/srv' })
    expect(await backend.logs('my-agent')).toBe('')
    writeFileSync(logFile, '1\n2\n3\n4\n')
    expect(await backend.logs('my-agent', { lines: 2 })).toBe('3\n4')
    expect(readFileSync(logFile, 'utf8')).toBe('1\n2\n3\n4\n')
  })

  it('reads the Task Scheduler log file and requires one', async () => {
    const logFile = join(tmp(), 'w.log')
    writeFileSync(logFile, 'x\ny\n')
    expect(await serviceBackend('win32', { logFile }).logs('t', { lines: 1 })).toBe('y')
    await expect(serviceBackend('win32', {}).logs('t')).rejects.toThrow(/logFile/)
  })

  it('refuses a bad line count', async () => {
    await expect(serviceBackend('darwin', {}).logs('t', { lines: 0 })).rejects.toThrow(RangeError)
  })
})
