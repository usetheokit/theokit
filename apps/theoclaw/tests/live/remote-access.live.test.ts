import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { useForwardCleanup } from './support/forward-cleanup.js'
import { findBinary, openSshForward, waitForForward } from './support/ssh-forward.js'

/**
 * OC-24 (B-512): the owner reaches the loopback control plane from another machine through an SSH
 * local forward. Every test here runs a real `sshd` the harness starts from a temp directory, never
 * the host's, and a real `ssh -N -L` client with only the run's own configuration. Runs only with
 * THEOCLAW_LIVE=1; once enabled, a missing binary fails by name and never skips.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'

const scratch: string[] = []

/** A directory holding links to the named binaries only, so the harness searches nothing else. */
function binDirWith(names: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-bin-'))
  scratch.push(dir)
  for (const name of names) symlinkSync(findBinary(name), join(dir, name))
  return dir
}

/** A port nothing listens on: bound on port 0, read, released. */
async function releasedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address for the probe server')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

/** A throwaway server that writes back what it reads, standing in for TheoClaw in the harness tests. */
async function echoServer(): Promise<{ readonly port: number; readonly server: Server }> {
  const server = createServer((socket) => socket.pipe(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address for the echo server')
  return { port: address.port, server }
}

describe.skipIf(!LIVE)('remote access over an SSH local forward', () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
  useForwardCleanup()

  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('fails naming the binary when ssh cannot be found', async () => {
    const binDir = binDirWith(['sshd', 'ssh-keygen'])
    await expect(openSshForward({ targetPort: 1, binDir })).rejects.toThrow(/binary not found: ssh /)
  })

  it('fails naming the binary when sshd cannot be found', async () => {
    const binDir = binDirWith(['ssh', 'ssh-keygen'])
    await expect(openSshForward({ targetPort: 1, binDir })).rejects.toThrow(/binary not found: sshd /)
  })

  it('fails naming the binary when ssh-keygen cannot be found', async () => {
    const binDir = binDirWith(['sshd', 'ssh'])
    await expect(openSshForward({ targetPort: 1, binDir })).rejects.toThrow(/binary not found: ssh-keygen /)
  })

  it('fails naming the port after the 10000 ms deadline when the forward never opens', async () => {
    const freePort = await releasedPort()
    const t0 = Date.now()
    await expect(waitForForward(freePort)).rejects.toThrow(new RegExp(String(freePort)))
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(9000)
    expect(elapsed).toBeLessThanOrEqual(11000)
  })

  it("spawns sshd and ssh with the run's own configuration only", async () => {
    const echo = await echoServer()
    try {
      const forward = await openSshForward({ targetPort: echo.port })
      const a = forward.spawnedArgs()
      expect(a.ssh).toEqual(
        expect.arrayContaining(['-F', '/dev/null', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null']),
      )
      expect(a.ssh).toContain(`UserKnownHostsFile=${join(forward.tempDir, 'known_hosts')}`)
      expect(a.sshd[a.sshd.indexOf('-f') + 1]?.startsWith(forward.tempDir)).toBe(true)
      expect(forward.sshdPort).not.toBe(22)
      await forward.close()
    } finally {
      await new Promise<void>((resolve) => echo.server.close(() => resolve()))
    }
  })
})
