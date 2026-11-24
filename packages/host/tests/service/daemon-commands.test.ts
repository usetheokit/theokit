import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import {
  ServiceDefinitionError,
  daemonCommands,
  lingerEnabled,
  serviceBackend,
  type Runner,
  type ServiceBackend,
  type ServiceSpec,
} from '../../src/service/index.js'

function sink() {
  const stream = new PassThrough()
  let text = ''
  stream.on('data', (chunk: Buffer) => (text += chunk.toString()))
  return { stream, text: () => text }
}

function recorder(answers: Record<string, string> = {}) {
  const calls: { command: string; args: readonly string[] }[] = []
  const runner: Runner = async (command, args) => {
    calls.push({ command, args })
    const key = `${command} ${args[0] ?? ''}`
    return { code: 0, stdout: answers[key] ?? '', stderr: '' }
  }
  return { calls, runner }
}

function fake(platform: NodeJS.Platform) {
  const installed: ServiceSpec[] = []
  const backend: ServiceBackend = {
    platform,
    definitionPath: () => '/def',
    install: async (spec) => void installed.push(spec),
    uninstall: async () => undefined,
    status: async () => 'running',
    restart: async () => undefined,
    logs: async () => '',
  }
  return { backend, installed }
}

describe('daemonCommands', () => {
  it('on win32 moves env into the task arguments and gives the backend no env', async () => {
    const { backend, installed } = fake('win32')
    const commands = daemonCommands(backend, {
      stdout: sink().stream,
      stderr: sink().stream,
      env: {},
    })
    const code = await commands.install({
      label: 'my-app',
      command: 'C:\\node\\node.exe',
      args: ['C:\\app\\main.mjs'],
      env: { APP_CONFIG: 'x' },
      workingDirectory: 'C:\\app',
      entryArgs: () => ['--config', 'x'],
    })
    expect(code).toBe(0)
    expect(installed[0]?.args?.slice(-2)).toEqual(['--config', 'x'])
    expect(installed[0]?.env).toBeUndefined()
  })

  it('refuses env on win32 without entryArgs', async () => {
    const backend = serviceBackend('win32', { runner: recorder().runner, env: { USERNAME: 'me' } })
    const commands = daemonCommands(backend, {
      stdout: sink().stream,
      stderr: sink().stream,
      env: {},
    })
    await expect(
      commands.install({
        label: 'a',
        command: 'C:\\n.exe',
        args: [],
        env: { A: 'b' },
        workingDirectory: 'C:\\a',
      }),
    ).rejects.toBeInstanceOf(ServiceDefinitionError)
  })

  it('names loginctl enable-linger when Linger=no', async () => {
    const { runner } = recorder({ 'loginctl show-user': 'Linger=no\n' })
    const out = sink()
    const commands = daemonCommands(fake('linux').backend, {
      stdout: out.stream,
      stderr: sink().stream,
      env: { USER: 'me' },
      runner,
    })
    await commands.install({
      label: 'my-app',
      command: '/usr/bin/node',
      args: ['/a/main.mjs'],
      workingDirectory: '/a',
    })
    expect(out.text()).toContain('loginctl enable-linger me')
  })

  it('status returns 3 for a stopped service and 0 for a running one', async () => {
    const make = (state: string) => {
      const backend: ServiceBackend = {
        ...fake('linux').backend,
        status: async () => state as 'running',
      }
      return daemonCommands(backend, { stdout: sink().stream, stderr: sink().stream, env: {} })
    }
    expect(await make('stopped').status('x')).toBe(3)
    expect(await make('running').status('x')).toBe(0)
  })

  it('lingerEnabled answers true, false and undefined', async () => {
    expect(await lingerEnabled('me', recorder({ 'loginctl show-user': 'Linger=yes' }).runner)).toBe(
      true,
    )
    expect(await lingerEnabled('me', recorder({ 'loginctl show-user': 'Linger=no' }).runner)).toBe(
      false,
    )
    expect(
      await lingerEnabled('me', recorder({ 'loginctl show-user': 'odd' }).runner),
    ).toBeUndefined()
  })
})
