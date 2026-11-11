import type { DockerRunner } from '@theokit/agents/sandbox'
import { describe, expect, it } from 'vitest'

import { UsageError } from '../src/cli-args.js'
import { runCli } from '../src/cli.js'
import { sandboxCommand } from '../src/sandbox/sandbox-command.js'
import { parseRecreate } from '../src/sandbox/sandbox-containers.js'
import { harness } from './support/cli-harness.js'

const LISTING = ['theokit-sbx-aa\trunning\talpine:3\tmain', 'theokit-sbx-bb\texited\talpine:3\tagent:x:1'].join('\n')

function stub(stdout = LISTING): { runner: DockerRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner: DockerRunner = (args) => {
    calls.push([...args])
    return Promise.resolve({ stdout: args[0] === 'ps' ? stdout : '', stderr: '', code: 0, timedOut: false })
  }
  return { runner, calls }
}

function docker() {
  const h = harness()
  return { h, io: { ...h.io, env: { ...h.io.env, THEOCLAW_SANDBOX_BACKEND: 'docker' } } }
}

describe('parseRecreate', () => {
  it('takes --all or --session <id>, with --force', () => {
    expect(parseRecreate(['--all'])).toEqual({ all: true, force: false })
    expect(parseRecreate(['--session', 'main', '--force'])).toEqual({ all: false, force: true, session: 'main' })
  })
  it('refuses none, both, a missing id and an unknown flag', () => {
    expect(parseRecreate([])).toBeNull()
    expect(parseRecreate(['--all', '--session', 'x'])).toBeNull()
    expect(parseRecreate(['--session'])).toBeNull()
    expect(parseRecreate(['--all', '--browser'])).toBeNull()
  })
})

describe('theoclaw sandbox list', () => {
  it('lists only labelled containers, one line each, with a total', async () => {
    const { runner, calls } = stub()
    const { h, io } = docker()
    expect(await sandboxCommand(['list'], io, { dockerRunner: runner })).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('label=theoclaw.sandbox=true')
    expect(h.stdout()).toBe(
      'theokit-sbx-aa  Status: running  Image: alpine:3  Session: main\n' +
        'theokit-sbx-bb  Status: exited  Image: alpine:3  Session: agent:x:1\n' +
        'Total: 2 (1 running)\n',
    )
  })

  it('prints a zero total when there are none', async () => {
    const { h, io } = docker()
    await sandboxCommand(['list'], io, { dockerRunner: stub('').runner })
    expect(h.stdout()).toBe('Total: 0 (0 running)\n')
  })

  it('reports a docker failure and exits 1', async () => {
    const { h, io } = docker()
    const runner: DockerRunner = () => Promise.resolve({ stdout: '', stderr: 'no daemon', code: 1, timedOut: false })
    expect(await sandboxCommand(['list'], io, { dockerRunner: runner })).toBe(1)
    expect(h.stderr()).toMatch(/no daemon/)
  })
})

describe('theoclaw sandbox recreate', () => {
  it('--all --force removes every container without asking', async () => {
    const { runner, calls } = stub()
    const { io } = docker()
    const confirm = () => Promise.reject(new Error('must not ask'))
    expect(await sandboxCommand(['recreate', '--all', '--force'], io, { dockerRunner: runner, confirm })).toBe(0)
    expect(calls[1]).toEqual(['rm', '-f', 'theokit-sbx-aa', 'theokit-sbx-bb'])
  })

  it('--session removes only that session\'s containers', async () => {
    const { runner, calls } = stub()
    const { io } = docker()
    await sandboxCommand(['recreate', '--session', 'agent:x', '--force'], io, { dockerRunner: runner })
    expect(calls[1]).toEqual(['rm', '-f', 'theokit-sbx-bb'])
  })

  it('asks before removing a running container and keeps it on no', async () => {
    const { runner, calls } = stub()
    const { h, io } = docker()
    const asked: string[][] = []
    const confirm = (running: readonly { name: string }[]) => {
      asked.push(running.map((c) => c.name))
      return Promise.resolve(false)
    }
    expect(await sandboxCommand(['recreate', '--all'], io, { dockerRunner: runner, confirm })).toBe(1)
    expect(asked).toEqual([['theokit-sbx-aa']])
    expect(calls[1]).toEqual(['rm', '-f', 'theokit-sbx-bb'])
    expect(h.stderr()).toMatch(/kept theokit-sbx-aa/)
  })

  it('removes the running container on yes, and never asks when none runs', async () => {
    const { runner, calls } = stub()
    const { io } = docker()
    await sandboxCommand(['recreate', '--all'], io, { dockerRunner: runner, confirm: () => Promise.resolve(true) })
    expect(calls[1]).toEqual(['rm', '-f', 'theokit-sbx-aa', 'theokit-sbx-bb'])
    const idle = stub('theokit-sbx-bb\texited\talpine:3\tmain')
    const confirm = () => Promise.reject(new Error('must not ask'))
    await sandboxCommand(['recreate', '--all'], io, { dockerRunner: idle.runner, confirm })
    expect(idle.calls[1]).toEqual(['rm', '-f', 'theokit-sbx-bb'])
  })

  it('refuses arguments that name neither --all nor --session', async () => {
    const { io } = docker()
    await expect(sandboxCommand(['recreate'], io, { dockerRunner: stub().runner })).rejects.toThrow(UsageError)
    await expect(sandboxCommand(['prune'], io)).rejects.toThrow(UsageError)
  })
})

describe('with the bwrap backend', () => {
  it('both commands say there is nothing to manage and exit 0, running no docker', async () => {
    const h = harness()
    const runner: DockerRunner = () => Promise.reject(new Error('no docker expected'))
    expect(await sandboxCommand(['list'], h.io, { dockerRunner: runner })).toBe(0)
    expect(await sandboxCommand(['recreate', '--all'], h.io, { dockerRunner: runner })).toBe(0)
    expect(h.stdout()).toMatch(/no sandbox containers to manage/)
  })

  it('is reachable through the CLI', async () => {
    const h = harness()
    expect(await runCli(['sandbox', 'list'], h.io)).toBe(0)
  })
})
