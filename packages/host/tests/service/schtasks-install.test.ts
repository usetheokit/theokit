import { closeSync, existsSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ServiceCommandError, serviceBackend, type Runner } from '../../src/service/index.js'

const spec = {
  label: 'my-agent',
  command: 'C:\\node\\node.exe',
  args: ['C:\\app\\main.js'],
  workingDirectory: 'C:\\app',
}
const env = { USERNAME: 'me', USERDOMAIN: 'HOST' }

describe('schtasks install', () => {
  it('writes a private UTF-16 file in a fresh directory and removes it', async () => {
    const calls: string[] = []
    let xmlPath = ''
    let mode = 0
    let bytes = Buffer.alloc(0)
    const runner: Runner = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '))
      if (args[0] === '/Create') {
        xmlPath = args[args.indexOf('/XML') + 1]!
        const fd = openSync(xmlPath, 'r')
        try {
          mode = fstatSync(fd).mode & 0o777
          bytes = readFileSync(fd)
        } finally {
          closeSync(fd)
        }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    await serviceBackend('win32', { runner, env }).install(spec)
    expect(mode).toBe(0o600)
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe])
    expect(bytes.subarray(2).toString('utf16le')).toContain('<UserId>HOST\\me</UserId>')
    expect(existsSync(dirname(xmlPath))).toBe(false)
    expect(calls.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
      'schtasks /End',
      'schtasks /Create',
      'schtasks /Run',
    ])
  })

  it('deletes the task and throws when /Create fails', async () => {
    const calls: string[] = []
    let xmlPath = ''
    const runner: Runner = async (_c, args) => {
      calls.push(args[0]!)
      if (args[0] === '/Create') xmlPath = args[args.indexOf('/XML') + 1]!
      return { code: args[0] === '/Create' ? 1 : 0, stdout: '', stderr: 'denied' }
    }
    await expect(serviceBackend('win32', { runner, env }).install(spec)).rejects.toBeInstanceOf(
      ServiceCommandError,
    )
    expect(calls).toEqual(['/End', '/Create', '/Delete'])
    expect(existsSync(dirname(xmlPath))).toBe(false)
  })
})
