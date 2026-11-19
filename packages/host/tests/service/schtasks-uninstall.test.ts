import { describe, expect, it } from 'vitest'

import { ServiceCommandError, serviceBackend, type Runner } from '../../src/service/index.js'

function fake(presence: string, scripts: string[] = []): Runner {
  return async (cmd, args) => {
    if (cmd === 'schtasks') return { code: args[0] === '/Delete' ? 1 : 0, stdout: '', stderr: 'x' }
    const script = args.at(-1)!
    scripts.push(script)
    if (script.startsWith('if (Get-ScheduledTask')) return { code: 0, stdout: presence, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
}

describe('schtasks uninstall', () => {
  it('resolves when /Delete fails and the task is absent', async () => {
    await expect(serviceBackend('win32', { runner: fake('absent') }).uninstall('t')).resolves.toBe(
      undefined,
    )
  })

  it('throws when /Delete fails and presence is unknown', async () => {
    await expect(
      serviceBackend('win32', { runner: fake('garbled') }).uninstall('t'),
    ).rejects.toBeInstanceOf(ServiceCommandError)
  })

  it('throws when /Delete fails and the task is present', async () => {
    await expect(
      serviceBackend('win32', { runner: fake('present') }).uninstall('t'),
    ).rejects.toBeInstanceOf(ServiceCommandError)
  })

  it('maps Get-ScheduledTask states', async () => {
    const state = (out: string) =>
      serviceBackend('win32', {
        runner: async () => ({ code: 0, stdout: out, stderr: '' }),
      }).status('t')
    expect(await state('Running\r\n')).toBe('running')
    expect(await state('Ready')).toBe('stopped')
    expect(await state('')).toBe('not-installed')
    expect(await state('Weird')).toBe('unknown')
  })
})
