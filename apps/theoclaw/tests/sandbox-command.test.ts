import { PassThrough } from 'node:stream'

import type { DockerRunner } from '@theokit/agents/sandbox'
import { describe, expect, it } from 'vitest'

import { UsageError } from '../src/cli-args.js'
import { labelDockerRuns } from '../src/sandbox/sandbox-backend.js'
import { parseSandbox, sandboxCommand } from '../src/sandbox/sandbox-command.js'

const ROWS = [
  'aaa\tsbx-one\trunning\talpine:3\tmain',
  'bbb\tsbx-two\texited\talpine:3\tother',
].join('\n')

function stub(stdout = ROWS, code = 0): { runner: DockerRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner: DockerRunner = (args) => {
    calls.push([...args])
    return Promise.resolve({ stdout: args[0] === 'ps' ? stdout : '', stderr: code === 0 ? '' : 'boom', code, timedOut: false })
  }
  return { runner, calls }
}

function run(args: string[], docker: DockerRunner, env: NodeJS.ProcessEnv = { THEOCLAW_SANDBOX_BACKEND: 'docker' }, isTTY = false, answer = '') {
  let out = ''
  let err = ''
  const stdout = new PassThrough().on('data', (c: Buffer) => (out += c.toString()))
  const stderr = new PassThrough().on('data', (c: Buffer) => (err += c.toString()))
  const stdin = new PassThrough()
  if (answer !== '') stdin.end(answer)
  return sandboxCommand(args, { env, stdin, stdout, stderr, isTTY, docker }).then((code) => ({ code, out, err }))
}

describe('parseSandbox', () => {
  it('accepts list and recreate with --all or --session', () => {
    expect(parseSandbox(['list'])).toEqual({ verb: 'list' })
    expect(parseSandbox(['recreate', '--all', '--force'])).toEqual({ verb: 'recreate', force: true })
    expect(parseSandbox(['recreate', '--session', 's1'])).toEqual({ verb: 'recreate', session: 's1', force: false })
  })

  it('refuses anything else', () => {
    for (const bad of [[], ['x'], ['list', '--all'], ['recreate'], ['recreate', '--all', '--session', 'a'], ['recreate', '--session'], ['recreate', '--bogus']]) {
      expect(() => parseSandbox(bad)).toThrow(UsageError)
    }
  })
})

describe('sandbox list', () => {
  it('asks docker for labelled containers only and prints a line each and a total', async () => {
    const { runner, calls } = stub()
    const { code, out } = await run(['list'], runner)
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('label=theoclaw.sandbox=1')
    expect(out).toContain('sbx-one  Status: running  Image: alpine:3  Backend: docker  Session: main')
    expect(out).toContain('Total: 2 (1 running)')
  })

  it('says nothing to manage under bwrap and never calls docker', async () => {
    const { runner, calls } = stub()
    const { code, out } = await run(['list'], runner, {})
    expect(code).toBe(0)
    expect(out).toMatch(/no containers to manage/)
    expect(calls).toHaveLength(0)
  })

  it('exits 1 with the docker error', async () => {
    const { runner } = stub('', 1)
    const { code, err } = await run(['list'], runner)
    expect(code).toBe(1)
    expect(err).toMatch(/docker ps failed: boom/)
  })
})

describe('sandbox recreate', () => {
  it('--all --force removes every labelled container without asking', async () => {
    const { runner, calls } = stub()
    const { code } = await run(['recreate', '--all', '--force'], runner)
    expect(code).toBe(0)
    expect(calls[1]).toEqual(['rm', '-f', 'aaa', 'bbb'])
  })

  it('--session removes only that session', async () => {
    const { runner, calls } = stub()
    await run(['recreate', '--session', 'other'], runner)
    expect(calls[1]).toEqual(['rm', '-f', 'bbb'])
  })

  it('without --force refuses a running container when not interactive', async () => {
    const { runner, calls } = stub()
    const { code, err } = await run(['recreate', '--all'], runner)
    expect(code).toBe(1)
    expect(err).toMatch(/--force/)
    expect(calls.some((c) => c[0] === 'rm')).toBe(false)
  })

  it('asks on a terminal and removes on yes, keeps on no', async () => {
    const yes = stub()
    expect((await run(['recreate', '--all'], yes.runner, undefined, true, 'y\n')).code).toBe(0)
    expect(yes.calls[1]).toEqual(['rm', '-f', 'aaa', 'bbb'])
    const no = stub()
    expect((await run(['recreate', '--all'], no.runner, undefined, true, 'n\n')).code).toBe(1)
    expect(no.calls.some((c) => c[0] === 'rm')).toBe(false)
  })

  it('removes a stopped container without asking', async () => {
    const { runner, calls } = stub('bbb\tsbx-two\texited\talpine:3\tother')
    expect((await run(['recreate', '--all'], runner)).code).toBe(0)
    expect(calls[1]).toEqual(['rm', '-f', 'bbb'])
  })

  it('does nothing under bwrap', async () => {
    const { runner, calls } = stub()
    expect((await run(['recreate', '--all', '--force'], runner, {})).code).toBe(0)
    expect(calls).toHaveLength(0)
  })
})

describe('labelDockerRuns', () => {
  it('labels a run, drops --rm, and removes the session\'s older exited containers', async () => {
    const calls: string[][] = []
    const base: DockerRunner = (args) => {
      calls.push([...args])
      const stdout = args[0] === 'ps' && args.includes('-aq') ? (args.includes('status=exited') ? 'old\nnew\n' : 'new\n') : ''
      return Promise.resolve({ stdout, stderr: '', code: 0, timedOut: false })
    }
    await labelDockerRuns(base, 's1')(['run', '--rm', '--name', 'n1', 'alpine:3'], { timeoutMs: 1, maxOutputBytes: 1 })
    expect(calls[0]).toEqual(['run', '--label', 'theoclaw.sandbox=1', '--label', 'theoclaw.session=s1', '--name', 'n1', 'alpine:3'])
    expect(calls.at(-1)).toEqual(['rm', 'old'])
  })

  it('passes other docker calls through', async () => {
    const calls: string[][] = []
    const base: DockerRunner = (args) => {
      calls.push([...args])
      return Promise.resolve({ stdout: '', stderr: '', code: 0, timedOut: false })
    }
    await labelDockerRuns(base, 's1')(['info'], { timeoutMs: 1, maxOutputBytes: 1 })
    expect(calls).toEqual([['info']])
  })
})
