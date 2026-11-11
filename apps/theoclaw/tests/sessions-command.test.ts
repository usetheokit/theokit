import { mkdirSync, writeFileSync } from 'node:fs'
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
    { type: 'assistant', sessionId: id, message: { content: [{ type: 'text', text: 'hi owner' }] } },
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
    expect(json.out).toBe('{"role":"user","text":"hello there"}\n{"role":"assistant","text":"hi owner"}\n')
    expect((await run(['sessions', 'show', 'matrix-dm'], workspace)).out).toContain('messages: 2')
  })

  it('exits 1 for an unknown id and 2 for a bad verb', async () => {
    const workspace = workspaceWithSession()
    expect((await run(['sessions', 'export', 'nope'], workspace)).code).toBe(1)
    expect((await run(['sessions', 'frob'], workspace)).code).toBe(2)
  })

  it('transcripts list and show print the stored chat', async () => {
    const workspace = workspaceWithSession()
    expect((await run(['transcripts', 'list'], workspace)).out).toContain('matrix-dm-_owner_localhost-g0\t2 messages')
    expect((await run(['transcripts', 'show', 'matrix-dm'], workspace)).out).toBe('user: hello there\nassistant: hi owner\n')
    expect((await run(['transcripts', 'frob'], workspace)).code).toBe(2)
  })
})
