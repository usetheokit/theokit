import { PassThrough, Writable } from 'node:stream'

import type { DockerRunner } from '@theokit/agents/sandbox'
import { describe, expect, it } from 'vitest'

import { UsageError } from '../src/cli-args.js'
import { createDockerBackend } from '../src/sandbox/sandbox-backend.js'
import { parseSandboxArgs, sandboxCommand } from '../src/sandbox/sandbox-containers.js'

function sink(): { stream: Writable; text: () => string } {
  let out = ''
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      out += chunk.toString()
      done()
    },
  })
  return { stream, text: () => out }
}

function harness(env: Record<string, string>, psOut = '', isTTY = false, answer = '') {
  const calls: string[][] = []
  const runner: DockerRunner = (args) => {
    calls.push([...args])
    return Promise.resolve({ stdout: args[0] === 'ps' ? psOut : '', stderr: '', code: 0, timedOut: false })
  }
  const stdout = sink()
  const stderr = sink()
  const stdin = new PassThrough()
  stdin.end(answer)
  const io = { env, stdin, stdout: stdout.stream, stderr: stderr.stream, isTTY }
  return { calls, runner, io, stdout, stderr }
}

const PS = 'sbx-a\trunning\talpine:3\tmain\nsbx-b\texited\talpine:3\tother\n'
const DOCKER = { THEOCLAW_SANDBOX_BACKEND: 'docker' }

describe('parseSandboxArgs', () => {
  it('accepts list and the recreate forms', () => {
    expect(parseSandboxArgs(['list'])).toEqual({ verb: 'list' })
    expect(parseSandboxArgs(['recreate', '--all', '--force'])).toEqual({ verb: 'recreate', session: undefined, force: true })
    expect(parseSandboxArgs(['recreate', '--session', 'x'])).toEqual({ verb: 'recreate', session: 'x', force: false })
  })
  it('refuses the rest', () => {
    for (const bad of [[], ['nope'], ['list', 'x'], ['recreate'], ['recreate', '--all', '--session', 'x'], ['recreate', '--session'], ['recreate', '--all', '--x']])
      expect(() => parseSandboxArgs(bad)).toThrow(UsageError)
  })
})

describe('theoclaw sandbox', () => {
  it('says there is nothing to manage under bwrap, and calls no docker', async () => {
    const h = harness({})
    expect(await sandboxCommand(['list'], h.io, { dockerRunner: h.runner })).toBe(0)
    expect(h.stdout.text()).toMatch(/nothing to manage/)
    expect(h.calls).toEqual([])
  })

  it('lists only labelled containers with a total', async () => {
    const h = harness(DOCKER, PS)
    expect(await sandboxCommand(['list'], h.io, { dockerRunner: h.runner })).toBe(0)
    expect(h.calls[0]).toContain('label=theoclaw.sandbox=1')
    expect(h.stdout.text()).toContain('sbx-a  Status: running  Image: alpine:3  Session: main')
    expect(h.stdout.text()).toContain('Total: 2 (1 running)')
  })

  it('removes all with --force', async () => {
    const h = harness(DOCKER, PS)
    expect(await sandboxCommand(['recreate', '--all', '--force'], h.io, { dockerRunner: h.runner })).toBe(0)
    expect(h.calls[1]).toEqual(['rm', '-f', 'sbx-a', 'sbx-b'])
  })

  it('removes only the named session', async () => {
    const h = harness(DOCKER, PS)
    await sandboxCommand(['recreate', '--session', 'other'], h.io, { dockerRunner: h.runner })
    expect(h.calls[1]).toEqual(['rm', '-f', 'sbx-b'])
  })

  it('refuses to remove a running container without --force when not interactive', async () => {
    const h = harness(DOCKER, PS)
    expect(await sandboxCommand(['recreate', '--all'], h.io, { dockerRunner: h.runner })).toBe(1)
    expect(h.calls).toHaveLength(1)
  })

  it('asks on a terminal and honors yes', async () => {
    const h = harness(DOCKER, PS, true, 'y\n')
    expect(await sandboxCommand(['recreate', '--all'], h.io, { dockerRunner: h.runner })).toBe(0)
    expect(h.calls[1]?.[0]).toBe('rm')
  })

  it('reports a docker failure', async () => {
    const h = harness(DOCKER)
    const runner: DockerRunner = () => Promise.resolve({ stdout: '', stderr: 'no daemon', code: 1, timedOut: false })
    expect(await sandboxCommand(['list'], h.io, { dockerRunner: runner })).toBe(1)
    expect(h.stderr.text()).toMatch(/no daemon/)
  })
})

describe('container labelling', () => {
  it('labels the run, drops --rm and prunes older exited containers of the session', async () => {
    const calls: string[][] = []
    const runner: DockerRunner = (args) => {
      calls.push([...args])
      return Promise.resolve({ stdout: args[0] === 'ps' ? 'old\nnew\n' : '', stderr: '', code: 0, timedOut: false })
    }
    const backend = createDockerBackend('workspace-write', '/tmp', { dockerRunner: runner }, 's1')
    await backend.execute('true')
    const run = calls[0] ?? []
    expect(run).not.toContain('--rm')
    expect(run.join(' ')).toContain('--label theoclaw.sandbox=1 --label theoclaw.session=s1')
    const name = run[run.indexOf('--name') + 1]
    expect(name).toBeDefined()
    expect(calls.some((c) => c[0] === 'ps' && c.includes('label=theoclaw.session=s1'))).toBe(true)
    expect(calls.at(-1)).toEqual(['rm', '-f', 'old', 'new'])
  })
})
