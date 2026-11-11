import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../../src/cli.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'
import { harness } from '../support/cli-harness.js'

/**
 * OC-77: after one `shell_exec` under THEOCLAW_SANDBOX_BACKEND=docker, `sandbox list` names its
 * container and `sandbox recreate --all --force` leaves `docker ps -a` without it. Needs a Docker
 * daemon; skipped (reason in the title) when `docker info` fails. A person runs it before the release.
 */
const dockerUp = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe.skipIf(!dockerUp)('sandbox list and recreate against a real daemon (skipped: `docker info` fails)', () => {
  it('lists the container a shell_exec left and removes it on recreate', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker' }
    const settings = resolveToolSettings(env, workspace.path)
    expect((await settings.sandbox.execute('true')).exitCode).toBe(0)

    const h = harness()
    const io = { ...h.io, env: { ...h.io.env, PATH: process.env.PATH, ...env } }
    expect(await runCli(['sandbox', 'list'], io)).toBe(0)
    const name = /^(theokit-sbx-\w+) {2}Status: \w+ {2}Image: \S+ {2}Session: main$/m.exec(h.stdout())?.[1]
    expect(name).toBeDefined()
    const psAll = () => spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout
    expect(psAll()).toContain(name)

    expect(await runCli(['sandbox', 'recreate', '--all', '--force'], io)).toBe(0)
    expect(psAll()).not.toContain(name)
  })
})
