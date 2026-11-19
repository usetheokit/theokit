import { describe, expect, it } from 'vitest'

import { ServiceDefinitionError, systemdUnit } from '../../src/service/index.js'

const base = { label: 'app', command: '/usr/bin/node', workingDirectory: '/srv/app' }

describe('systemdUnit', () => {
  it('quotes per systemd.syntax(7) and doubles $ only in ExecStart', () => {
    const odd = '/opt/my app/"q"\\b%h$X'
    const unit = systemdUnit({ ...base, args: [odd], env: { A: odd }, workingDirectory: odd })
    expect(unit).toContain('ExecStart=/usr/bin/node "/opt/my app/\\"q\\"\\\\b%%h$$X"')
    expect(unit).toContain('Environment="A=/opt/my app/\\"q\\"\\\\b%%h$X"')
    expect(unit).toContain('WorkingDirectory=/opt/my app/"q"\\b%%h$X')
  })

  it('refuses a line break, naming the field and not the value', () => {
    const secret = 'sekret\nvalue'
    for (const spec of [
      { ...base, args: [secret] },
      { ...base, env: { K: secret } },
      { ...base, workingDirectory: `/${secret}` },
    ]) {
      let caught: unknown
      try {
        systemdUnit(spec)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ServiceDefinitionError)
      expect((caught as Error).message).not.toContain('sekret')
    }
    expect(() => systemdUnit({ ...base, args: ['a\nb'] })).toThrow(/args\[0\]/)
  })

  it('refuses a bad label and a relative path', () => {
    expect(() => systemdUnit({ ...base, label: 'a/b' })).toThrow(ServiceDefinitionError)
    expect(() => systemdUnit({ ...base, command: 'node' })).toThrow(/command/)
  })
})
