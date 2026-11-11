import { lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { harness, scratchDir } from './support/cli-harness.js'

function workspaceWithSession(): string {
  const workspace = scratchDir()
  const dir = join(workspace, '.theoclaw', 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const id = 'matrix-dm-_owner_localhost-g0'
  const lines = [
    { type: 'user', sessionId: id, message: { content: [{ type: 'text', text: 'hello there' }] } },
    {
      type: 'assistant',
      sessionId: id,
      message: { content: [{ type: 'text', text: 'hi owner' }] },
    },
    { type: 'user', sessionId: id, message: { content: [{ type: 'tool_result', content: 'x' }] } },
  ]
  writeFileSync(join(dir, 'abc.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return workspace
}

async function run(args: string[], workspace: string) {
  const h = harness()
  const code = await runCli(args, { ...h.io, env: { ...h.io.env, THEOCLAW_WORKSPACE: workspace } })
  return { code, out: h.stdout(), err: h.stderr() }
}

describe('theoclaw sessions', () => {
  it('lists the Matrix DM session', async () => {
    const { code, out } = await run(['sessions', 'list'], workspaceWithSession())
    expect(code).toBe(0)
    expect(out).toContain('matrix-dm-_owner_localhost-g0\t2 messages')
  })

  it('exports its messages, by id prefix', async () => {
    const workspace = workspaceWithSession()
    const text = await run(['sessions', 'export', 'matrix-dm'], workspace)
    expect(text.out).toBe('user: hello there\nassistant: hi owner\n')
    const json = await run(['sessions', 'export', 'matrix-dm', '--json'], workspace)
    expect(json.out).toBe(
      '{"role":"user","text":"hello there"}\n{"role":"assistant","text":"hi owner"}\n',
    )
    expect((await run(['sessions', 'show', 'matrix-dm'], workspace)).out).toContain('messages: 2')
  })

  it('exits 1 for an unknown id and 2 for a bad verb', async () => {
    const workspace = workspaceWithSession()
    expect((await run(['sessions', 'export', 'nope'], workspace)).code).toBe(1)
    expect((await run(['sessions', 'frob'], workspace)).code).toBe(2)
  })

  it('transcripts list and show print the stored chat', async () => {
    const workspace = workspaceWithSession()
    expect((await run(['transcripts', 'list'], workspace)).out).toContain(
      'matrix-dm-_owner_localhost-g0\t2 messages',
    )
    expect((await run(['transcripts', 'show', 'matrix-dm'], workspace)).out).toBe(
      'user: hello there\nassistant: hi owner\n',
    )
    expect((await run(['transcripts', 'frob'], workspace)).code).toBe(2)
  })

  it('shares a session read-only to another profile, which opens but cannot write it', async () => {
    const workspace = workspaceWithSession()
    const shared = scratchDir()
    const shareRun = await run(['sessions', 'share', 'matrix-dm', '--to', shared], workspace)
    expect(shareRun.code).toBe(0)
    const other = await run(['sessions', 'open', 'matrix-dm', '--from', shared], scratchDir())
    expect(other.out).toBe(
      'shared session matrix-dm-_owner_localhost-g0 (read-only)\nuser: hello there\nassistant: hi owner\n',
    )
    const file = join(shared, 'shared-sessions', 'matrix-dm-_owner_localhost-g0.json')
    expect(statSync(file).mode & 0o222).toBe(0)
    expect((await run(['sessions', 'open', 'nope', '--from', shared], workspace)).code).toBe(1)
    expect((await run(['sessions', 'share', 'matrix-dm'], workspace)).code).toBe(2)
  })

  it('does not follow a link planted where the shared file goes', async () => {
    const workspace = workspaceWithSession()
    const shared = scratchDir()
    const victim = join(scratchDir(), 'victim.txt')
    writeFileSync(victim, 'keep')
    mkdirSync(join(shared, 'shared-sessions'), { recursive: true })
    const file = join(shared, 'shared-sessions', 'matrix-dm-_owner_localhost-g0.json')
    symlinkSync(victim, file)
    expect((await run(['sessions', 'share', 'matrix-dm', '--to', shared], workspace)).code).toBe(0)
    expect(readFileSync(victim, 'utf8')).toBe('keep')
    expect(lstatSync(file).isSymbolicLink()).toBe(false)
  })
})

describe('theoclaw resume', () => {
  it('prints the last session messages', async () => {
    const { code, out } = await run(['resume'], workspaceWithSession())
    expect(code).toBe(0)
    expect(out).toBe(
      'resuming session matrix-dm-_owner_localhost-g0\nuser: hello there\nassistant: hi owner\n',
    )
  })

  it('fails when there is no session', async () => {
    const { code, err } = await run(['resume'], scratchDir())
    expect(code).toBe(1)
    expect(err).toContain('no session to resume')
  })
})
