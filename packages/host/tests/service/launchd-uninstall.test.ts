import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ServiceCommandError, serviceBackend, type Runner } from '../../src/service/index.js'

const homes: string[] = []
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true })
})
const spec = { label: 'my-agent', command: '/usr/bin/node', workingDirectory: '/srv' }

async function installed(codes: Record<string, number>) {
  const homeDir = mkdtempSync(join(tmpdir(), 'host-launchd-'))
  homes.push(homeDir)
  const runner: Runner = async (_c, args) => ({
    code: codes[args[0] ?? ''] ?? 0,
    stdout: '',
    stderr: '',
  })
  const backend = serviceBackend('darwin', { homeDir, uid: 501, runner })
  await backend.install(spec)
  return backend
}

describe('launchd uninstall', () => {
  it('removes the plist after a clean bootout', async () => {
    const backend = await installed({})
    await backend.uninstall('my-agent')
    expect(existsSync(backend.definitionPath(spec))).toBe(false)
  })

  it('removes the plist when bootout is refused and print says exit 113', async () => {
    const backend = await installed({ print: 113 })
    const runner = serviceBackend('darwin', { uid: 501, homeDir: '/x' })
    expect(runner.platform).toBe('darwin')
    // Re-create with a refusing bootout on the same home.
    const refusing = serviceBackend('darwin', {
      homeDir: backend.definitionPath(spec).split('/Library')[0]!,
      uid: 501,
      runner: async (_c, args) => ({
        code: args[0] === 'bootout' ? 1 : 113,
        stdout: '',
        stderr: '',
      }),
    })
    await refusing.uninstall('my-agent')
    expect(existsSync(backend.definitionPath(spec))).toBe(false)
  })

  it('keeps the plist and throws when bootout is refused and the service still prints', async () => {
    const backend = await installed({})
    const home = backend.definitionPath(spec).split('/Library')[0]!
    const refusing = serviceBackend('darwin', {
      homeDir: home,
      uid: 501,
      runner: async (_c, args) => ({
        code: args[0] === 'bootout' ? 1 : 0,
        stdout: '',
        stderr: 'no',
      }),
    })
    await expect(refusing.uninstall('my-agent')).rejects.toBeInstanceOf(ServiceCommandError)
    expect(existsSync(backend.definitionPath(spec))).toBe(true)
  })
})
