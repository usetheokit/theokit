import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ServiceCommandError,
  ServiceDefinitionError,
  serviceBackend,
  type Runner,
} from '../../src/service/index.js'

const homes: string[] = []
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true })
})
const home = (): string => {
  const h = mkdtempSync(join(tmpdir(), 'host-launchd-'))
  homes.push(h)
  return h
}
const spec = { label: 'my-agent', command: '/usr/bin/node', workingDirectory: '/srv' }

function fake(
  codes: Record<string, number> = {},
  stdout = '',
): { runner: Runner; calls: string[] } {
  const calls: string[] = []
  const runner: Runner = async (_c, args) => {
    calls.push(args.join(' '))
    return { code: codes[args[0] ?? ''] ?? 0, stdout, stderr: 'boom' }
  }
  return { runner, calls }
}

describe('launchd backend', () => {
  it('places the plist in LaunchAgents', () => {
    const homeDir = home()
    expect(serviceBackend('darwin', { homeDir }).definitionPath(spec)).toBe(
      join(homeDir, 'Library', 'LaunchAgents', 'my-agent.plist'),
    )
  })

  it('needs a user id to install', async () => {
    await expect(serviceBackend('darwin', { homeDir: home() }).install(spec)).rejects.toThrow(
      ServiceDefinitionError,
    )
  })

  it('boots out before it bootstraps on reinstall', async () => {
    const homeDir = home()
    const { runner, calls } = fake({ bootout: 113 })
    const backend = serviceBackend('darwin', { homeDir, uid: 501, runner })
    await backend.install(spec)
    await backend.install(spec)
    const path = backend.definitionPath(spec)
    expect(calls).toEqual([
      'bootout gui/501/my-agent',
      `bootstrap gui/501 ${path}`,
      'bootout gui/501/my-agent',
      `bootstrap gui/501 ${path}`,
    ])
    expect(existsSync(path)).toBe(true)
  })

  it('removes the plist and throws when bootstrap fails', async () => {
    const backend = serviceBackend('darwin', {
      homeDir: home(),
      uid: 501,
      runner: fake({ bootstrap: 5 }).runner,
    })
    const error = await backend.install(spec).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ServiceCommandError)
    expect(error).toMatchObject({ command: 'launchctl bootstrap', exitCode: 5 })
    expect(existsSync(backend.definitionPath(spec))).toBe(false)
  })

  it('maps print to a state', async () => {
    const at = (codes: Record<string, number>, out: string) =>
      serviceBackend('darwin', { homeDir: home(), uid: 501, runner: fake(codes, out).runner })
    expect(await at({}, '\tstate = running\n').status('a')).toBe('running')
    expect(await at({}, '\tstate = waiting\n').status('a')).toBe('stopped')
    expect(await at({ print: 113 }, '').status('a')).toBe('not-installed')
  })

  it('restarts with kickstart -k', async () => {
    const { runner, calls } = fake()
    await serviceBackend('darwin', { homeDir: home(), uid: 501, runner }).restart('my-agent')
    expect(calls).toEqual(['kickstart -k gui/501/my-agent'])
  })
})
