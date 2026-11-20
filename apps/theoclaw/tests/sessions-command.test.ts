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

function workspaceWithSession(): string {
  const workspace = scratchDir()
  const id = 'matrix-dm-_owner_localhost-g0'
  const turn = (type: string, uuid: string, parentUuid: string | null, content: unknown) => ({
    type,
    uuid,
    parentUuid,
    sessionId: id,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { content },
  })
  const lines = [
    turn('user', 'u1', null, text('hello there')),
    turn('assistant', 'a1', 'u1', text('hi owner')),
    turn('user', 'u2', 'a1', [{ type: 'tool_result', content: 'x' }]),
  ]
  // A line that is not JSON sits between the turns; the SDK reader skips it.
  const body = [
    JSON.stringify(lines[0]),
    '{not json',
    ...lines.slice(1).map((l) => JSON.stringify(l)),
  ]
  writeFileSync(join(projectDir(workspace), `${id}.jsonl`), body.join('\n') + '\n')
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

  it('shows what the SDK reader returns, not what the file holds', async () => {
    vi.mocked(readSessionMessages).mockResolvedValueOnce([
      { role: 'user', text: 'from the reader', parts: [{ type: 'text', text: 'from the reader' }] },
    ])
    const { out } = await run(['sessions', 'export', 'matrix-dm'], workspaceWithSession())
    expect(out).toBe('user: from the reader\n')
  })

  it('shows what the SDK reader returns for a compacted transcript', async () => {
    const id = 'compacted-g0'
    const turn = (type: string, uuid: string, parentUuid: string | null, value: string) => ({
      type,
      uuid,
      parentUuid,
      sessionId: id,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { content: text(value) },
    })
    const workspace = write(`${id}.jsonl`, [
      turn('user', 'u1', null, 'first question'),
      turn('assistant', 'a1', 'u1', 'first answer'),
      { type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null, sessionId: id },
      turn('user', 'u2', 'b1', 'second question'),
    ])
    const sdk = await readSessionMessages({
      sessionId: id,
      cwd: workspace,
      sessionDir: join(workspace, '.theoclaw'),
    })
    const expected = sdk.map((m) => `${m.role}: ${m.text}\n`).join('')
    expect(expected).not.toBe('')
    expect((await run(['sessions', 'export', 'compacted'], workspace)).out).toBe(expected)
  })

  it('does not fail on a transcript with string content', async () => {
    const id = 'legacy-g0'
    const workspace = write(`${id}.jsonl`, [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: id,
        message: { content: 'plain question' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: id,
        message: { content: text('answer') },
      },
    ])
    const { code, out } = await run(['sessions', 'export', 'legacy'], workspace)
    expect(code).toBe(0)
    expect(out).toBe('')
    expect((await run(['sessions', 'list'], workspace)).out).toContain('legacy-g0\t0 messages')
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
