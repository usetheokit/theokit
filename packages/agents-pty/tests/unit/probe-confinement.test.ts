import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createPtyOwner, probeConfinement } from '../../src/index.js'

type Mode = 'workspace-write' | 'danger-full-access'

function bwrapUsable(): string | undefined {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- a test-only availability check
    execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', 'true'], { stdio: 'ignore' })
    return undefined
  } catch {
    return 'bwrap is unavailable or cannot create a sandbox on this host'
  }
}
const skipReason = bwrapUsable()
if (skipReason !== undefined) console.warn(`probeConfinement sandbox test skipped: ${skipReason}`)

const q = (v: string): string => "'" + v.replaceAll("'", "'\\''") + "'"
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function owner(root: string, mode: Mode) {
  return createPtyOwner<Mode>({
    mode,
    maxSessions: 2,
    cwd: root,
    wrapFor: (m) => (command) =>
      m === 'workspace-write'
        ? `bwrap --ro-bind / / --dev /dev --bind ${q(root)} ${q(root)} /bin/sh -c ${q(command)}`
        : command,
  })
}

describe('probeConfinement', () => {
  it.skipIf(skipReason !== undefined)('is true for workspace-write', async () => {
    const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'probe-'))), 'root')
    dirs.push(join(root, '..'))
    const o = owner(root, 'workspace-write')
    try {
      expect(await probeConfinement(o.backend(), root)).toBe(true)
    } finally {
      o.shutdown()
    }
  })

  it('is false for danger-full-access', async () => {
    const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'probe-'))), 'root')
    dirs.push(join(root, '..'))
    const o = owner(root, 'danger-full-access')
    try {
      expect(await probeConfinement(o.backend(), root)).toBe(false)
    } finally {
      o.shutdown()
    }
  })

  it('is false when the session cannot start', async () => {
    const backend = {
      startInteractive: () => Promise.reject(new Error('no pty')),
      writeStdin: () => Promise.reject(new Error('no pty')),
      kill: () => undefined,
    }
    const dir = mkdtempSync(join(tmpdir(), 'probe-'))
    dirs.push(dir)
    expect(await probeConfinement(backend, join(dir, 'root'))).toBe(false)
  })
})
