import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDockerBackend } from '../src/sandbox/sandbox-backend.js'
import { sandboxCommand } from '../src/sandbox/sandbox-containers.js'
import { PassThrough, Writable } from 'node:stream'

const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
const reason = 'no Docker daemon: `docker info` failed; a person runs this before the release'

describe.skipIf(!hasDocker)(`sandbox containers against a real Docker daemon (${hasDocker ? 'enabled' : reason})`, () => {
  it('lists the container of one command, then recreate --all --force removes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theoclaw-e2e-'))
    try {
      const run = async (args: string[]): Promise<string> => {
        let out = ''
        const stdout = new Writable({ write: (c: Buffer, _e, d) => ((out += c.toString()), d()) })
        const io = { env: { THEOCLAW_SANDBOX_BACKEND: 'docker' }, stdin: new PassThrough(), stdout, stderr: stdout, isTTY: false }
        expect(await sandboxCommand(args, io)).toBe(0)
        return out
      }
      const result = await createDockerBackend('workspace-write', dir, {}, 'e2e-session').execute('echo hi')
      expect(result.exitCode).toBe(0)
      expect(await run(['list'])).toContain('Session: e2e-session')
      await run(['recreate', '--all', '--force'])
      const ps = spawnSync('docker', ['ps', '-a', '--filter', 'label=theoclaw.sandbox=1', '--format', '{{.Names}}'], { encoding: 'utf8' })
      expect(ps.stdout.trim()).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
