import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as childProcess from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

import { NodeAcpTransport, AcpTransportClosedError } from '../../src/server/agent/acp-tool.js'
import { resolveAgentCommand } from '../../src/server/agent/index.js'

const posix = process.platform !== 'win32'

function fakeAgent(dir: string, mode = 0o755): string {
  const file = join(dir, 'fake-agent')
  writeFileSync(file, '#!/bin/sh\necho hi\n')
  chmodSync(file, mode)
  return file
}

function closeOf(t: NodeAcpTransport): Promise<AcpTransportClosedError> {
  return new Promise((resolve) => {
    t.onClose(resolve)
  })
}

describe.skipIf(!posix)('resolveAgentCommand', () => {
  it('resolves on absolute PATH entries and never in a relative one under cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'resolve-agent-'))
    const abs = join(root, 'abs')
    mkdirSync(abs)
    const file = fakeAgent(abs)
    const cwd = process.cwd()
    process.chdir(root)
    try {
      mkdirSync(join(root, 'relative-dir'))
      fakeAgent(join(root, 'relative-dir'))
      expect(resolveAgentCommand('fake-agent', 'relative-dir:' + abs)).toBe(file)
      expect(resolveAgentCommand('fake-agent', ':' + 'relative-dir')).toBeUndefined()
    } finally {
      process.chdir(cwd)
    }
  })

  it('skips a non-executable file and refuses relative commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'resolve-agent-'))
    fakeAgent(root, 0o644)
    expect(resolveAgentCommand('fake-agent', root)).toBeUndefined()
    expect(resolveAgentCommand('./fake-agent', root)).toBeUndefined()
    expect(resolveAgentCommand('does-not-exist', root)).toBeUndefined()
  })

  it('accepts an absolute executable path', () => {
    const root = mkdtempSync(join(tmpdir(), 'resolve-agent-'))
    const file = fakeAgent(root)
    expect(resolveAgentCommand(file, undefined)).toBe(file)
  })

  it('skips a bare-name candidate whose path has "=" but accepts an absolute command with one', () => {
    const root = mkdtempSync(join(tmpdir(), 'resolve-agent-'))
    const eq = join(root, 'a=b')
    mkdirSync(eq)
    const file = fakeAgent(eq)
    expect(resolveAgentCommand('fake-agent', eq)).toBeUndefined()
    expect(resolveAgentCommand(file, undefined)).toBe(file)
  })
})

describe.skipIf(!posix)('NodeAcpTransport command resolution', () => {
  it.each(['does-not-exist', './agent'])('refuses %s before spawning', async (command) => {
    const spawn = vi.mocked(childProcess.spawn)
    spawn.mockClear()
    const t = new NodeAcpTransport(command, [], undefined, { PATH: '/usr/bin:/bin' })
    const err = await closeOf(t)
    expect(err).toBeInstanceOf(AcpTransportClosedError)
    expect(err.reason).toContain('could not be found or run')
    t.send('x\n')
    await t.close()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('gives the child only the absolute PATH entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'resolve-agent-'))
    const t = new NodeAcpTransport(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.PATH ?? "none")'],
      undefined,
      { PATH: `rel::.:${root}` },
    )
    let out = ''
    t.subscribe((c) => {
      out += c
    })
    await closeOf(t)
    await t.close()
    expect(out).toBe(root)
  })

  it('spawns the absolute-PATH copy of a bare command, never the one in a relative entry under cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'resolve-agent-'))
    const abs = join(root, 'abs')
    const cwd = join(root, 'cwd')
    mkdirSync(abs)
    mkdirSync(join(cwd, 'relative-dir'), { recursive: true })
    const script = (who: string): string => `#!/bin/sh\necho ${who}\n`
    for (const [dir, who] of [
      [abs, 'absolute'],
      [join(cwd, 'relative-dir'), 'relative'],
    ] as const) {
      const f = join(dir, 'fake-agent')
      writeFileSync(f, script(who))
      chmodSync(f, 0o755)
    }
    const spawn = vi.mocked(childProcess.spawn)
    spawn.mockClear()
    const t = new NodeAcpTransport('fake-agent', [], cwd, { PATH: 'relative-dir:' + abs })
    let out = ''
    t.subscribe((c) => {
      out += c
    })
    await closeOf(t)
    await t.close()
    expect(spawn.mock.calls[0]?.[0]).toBe(join(abs, 'fake-agent'))
    expect(out.trim()).toBe('absolute')
  })
})
