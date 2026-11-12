import { spawnSync } from 'node:child_process'
import { PassThrough } from 'node:stream'

import { afterAll, describe, expect, it } from 'vitest'

import { sandboxCommand } from '../../src/sandbox/sandbox-command.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'

/**
 * #1609: after one shell_exec under THEOCLAW_SANDBOX_BACKEND=docker, `sandbox list` names its container and
 * `sandbox recreate --all --force` leaves `docker ps -a` without it. A person runs this before the release:
 * the factory's sandbox has no Docker daemon.
 */
const dockerUp = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
if (!dockerUp) console.warn('sandbox-docker.live.test.ts skipped: `docker info` fails (no reachable Docker daemon)')

const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker' }

async function sandbox(args: string[]): Promise<{ code: number; out: string }> {
  let out = ''
  const stdout = new PassThrough().on('data', (c: Buffer) => (out += c.toString()))
  const code = await sandboxCommand(args, { env, stdin: new PassThrough(), stdout, stderr: new PassThrough(), isTTY: false })
  return { code, out }
}

describe.skipIf(!dockerUp)('theoclaw sandbox against a real Docker daemon', () => {
  const workspace = makeHostToolsWorkspace()
  afterAll(async () => {
    await sandbox(['recreate', '--all', '--force'])
    workspace.remove()
  })

  it('lists the container of a shell_exec and recreate removes it', async () => {
    const settings = resolveToolSettings(env, workspace.path)
    expect((await settings.sandbox.execute('echo hi')).exitCode).toBe(0)

    const listed = await sandbox(['list'])
    expect(listed.code).toBe(0)
    const name = /^(\S+)\s+Status:/m.exec(listed.out)?.[1]
    expect(name).toBeDefined()

    expect((await sandbox(['recreate', '--all', '--force'])).code).toBe(0)
    const ps = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' })
    expect(ps.stdout.split('\n')).not.toContain(name)
  })
})
