import { lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readSessionMessages } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import { runCli } from '../src/cli.js'
import { harness, scratchDir } from './support/cli-harness.js'

vi.mock('@theokit/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/sdk')>()
  return { ...actual, readSessionMessages: vi.fn(actual.readSessionMessages) }
})

function projectDir(workspace: string): string {
  const dir = join(workspace, '.theoclaw', 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

const text = (value: string) => [{ type: 'text', text: value }]

function turn(id: string, type: string, uuid: string, parentUuid: string | null, content: unknown) {
  return { type, uuid, parentUuid, sessionId: id, message: { content } }
}

function workspaceWithSession(): string {
  const workspace = scratchDir()
  const id = 'matrix-dm-_owner_localhost-g0'
  const lines = [
    turn(id, 'user', 'u1', null, text('hello there')),
    turn(id, 'assistant', 'a1', 'u1', text('hi owner')),
    turn(id, 'user', 'u2', 'a1', [{ type: 'tool_result', content: 'x' }]),
  ]
  writeFileSync(
    join(projectDir(workspace), `${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  )
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

describe('transcript reading', () => {
  function write(name: string, records: unknown[]): string {
    const workspace = scratchDir()
    writeFileSync(
      join(projectDir(workspace), name),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    )
    return workspace
  }

  it('goes through the SDK reader with the workspace as cwd', async () => {
    const workspace = workspaceWithSession()
    vi.mocked(readSessionMessages).mockClear()
    await run(['sessions', 'export', 'matrix-dm'], workspace)
    expect(readSessionMessages).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: workspace, sessionDir: expect.any(String) }),
    )
  })

  it('shows what the SDK reader returns, not what the file holds', async () => {
    vi.mocked(readSessionMessages).mockResolvedValueOnce([
      { role: 'user', text: 'from the reader', parts: [{ type: 'text', text: 'from the reader' }] },
    ])
    const { out } = await run(['sessions', 'export', 'matrix-dm'], workspaceWithSession())
    expect(out).toBe('user: from the reader\n')
  })

  it('reads by session id and session directory, from a file the SDK names', async () => {
    const id = 'by-id-g0'
    const workspace = write(`${id}.jsonl`, [
      turn(id, 'user', 'u1', null, text('asked')),
      turn(id, 'assistant', 'a1', 'u1', text('answered')),
    ])
    vi.mocked(readSessionMessages).mockClear()
    expect((await run(['sessions', 'export', 'by-id'], workspace)).out).toBe(
      'user: asked\nassistant: answered\n',
    )
    expect(readSessionMessages).toHaveBeenCalledWith({
      sessionId: id,
      cwd: workspace,
      sessionDir: join(workspace, '.theoclaw'),
    })
  })

  it('shows the compacted history the SDK returns, and no transcript is staged', async () => {
    const id = 'compacted-g0'
    const boundary = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b1',
      parentUuid: null,
      sessionId: id,
    }
    const workspace = write(`${id}.jsonl`, [
      turn(id, 'user', 'u1', null, text('first question')),
      turn(id, 'assistant', 'a1', 'u1', text('first answer')),
      boundary,
      turn(id, 'user', 'u2', 'b1', text('second question')),
      turn(id, 'assistant', 'a2', 'u2', text('second answer')),
    ])
    const sdk = await readSessionMessages({
      sessionId: id,
      cwd: workspace,
      sessionDir: join(workspace, '.theoclaw'),
    })
    vi.mocked(readSessionMessages).mockClear()
    const expected = sdk.map((m) => `${m.role}: ${m.text}\n`).join('')
    expect(expected).toContain('second answer')
    expect((await run(['sessions', 'export', 'compacted'], workspace)).out).toBe(expected)
    expect(readSessionMessages).toHaveBeenCalledTimes(1)
    expect(vi.mocked(readSessionMessages).mock.calls[0]![0]).not.toHaveProperty('transcript')
  })

  it('passes string-valued content to the SDK reader unchanged', async () => {
    const id = 'legacy-g0'
    const workspace = write(`${id}.jsonl`, [
      turn(id, 'user', 'u1', null, 'plain question'),
      turn(id, 'assistant', 'a1', 'u1', 'plain answer'),
    ])
    vi.mocked(readSessionMessages).mockClear()
    // Whether the SDK accepts such content is its decision; this helper no longer rewrites it.
    await run(['sessions', 'export', 'legacy'], workspace).catch(() => undefined)
    expect(readSessionMessages).toHaveBeenCalledTimes(1)
  })

  it('does not open the transcript file itself', async () => {
    const source = readFileSync(
      new URL('../src/sessions/transcript-history.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(/node:fs|JSON\.parse|writeFileSync|mkdtemp/)
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
