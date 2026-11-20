import { describe, expect, it } from 'vitest'

import { ServiceDefinitionError, serviceBackend, type Runner } from '../../src/service/index.js'

const spec = {
  label: 'my-agent',
  command: 'C:\\node\\node.exe',
  workingDirectory: 'C:\\app',
}

describe('schtasks refusals', () => {
  it('refuses spec.env before any command runs', async () => {
    let ran = 0
    const runner: Runner = async () => (ran++, { code: 0, stdout: '', stderr: '' })
    const backend = serviceBackend('win32', { runner, env: { USERNAME: 'me' } })
    const failure = backend.install({ ...spec, env: { A: 'b' } })
    await expect(failure).rejects.toBeInstanceOf(ServiceDefinitionError)
    await expect(failure).rejects.toThrow(
      'a scheduled task carries no environment; pass the values as args',
    )
    expect(ran).toBe(0)
  })

  it('names USERNAME when it is missing', async () => {
    let ran = 0
    const runner: Runner = async () => (ran++, { code: 0, stdout: '', stderr: '' })
    await expect(serviceBackend('win32', { runner, env: {} }).install(spec)).rejects.toThrow(
      /USERNAME/,
    )
    expect(ran).toBe(0)
  })
})
