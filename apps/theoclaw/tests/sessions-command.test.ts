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
  const lines = [
    { type: 'user', sessionId: id, message: { content: text('hello there') } },
    { type: 'assistant', sessionId: id, message: { content: text('hi owner') } },
    { type: 'user', sessionId: id, message: { content: [{ type: 'tool_result', content: 'x' }] } },
  ]
  // The file has its own name and no uuids; a line that is not JSON sits between the turns.
  const body = [
    JSON.stringify(lines[0]),
    '{not json',
    ...lines.slice(1).map((l) => JSON.stringify(l)),
  ]
  writeFileSync(join(projectDir(workspace), 'abc.jsonl'), body.join('\n') + '\n')
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

  it('keeps the messages before a compact boundary', async () => {
    const id = 'compacted-g0'
    const turn = (type: string, uuid: string, parentUuid: string | null, value: string) => ({
      type,
      uuid,
      parentUuid,
      sessionId: id,
      message: { content: text(value) },
    })
    const boundary = (uuid: string) => ({
      type: 'system',
      subtype: 'compact_boundary',
      uuid,
      parentUuid: null,
      sessionId: id,
    })
    const workspace = write(`${id}.jsonl`, [
      turn('user', 'u1', null, 'first question'),
      turn('assistant', 'a1', 'u1', 'first answer'),
      boundary('b1'),
      turn('user', 'u2', 'b1', 'second question'),
      turn('assistant', 'a2', 'u2', 'second answer'),
      boundary('b2'),
      turn('user', 'u3', 'b2', 'third question'),
    ])
    const expected =
      'user: first question\nassistant: first answer\nuser: second question\n' +
      'assistant: second answer\nuser: third question\n'
    expect((await run(['sessions', 'export', 'compacted'], workspace)).out).toBe(expected)
    expect((await run(['sessions', 'list'], workspace)).out).toContain('compacted-g0\t5 messages')
    expect((await run(['resume'], workspace)).out).toContain(expected)
    const shared = scratchDir()
    await run(['sessions', 'share', 'compacted', '--to', shared], workspace)
    const snapshot = JSON.parse(
      readFileSync(join(shared, 'shared-sessions', `${id}.json`), 'utf8'),
    ) as { messages: unknown[] }
    expect(snapshot.messages).toHaveLength(5)
  })

  it('keeps every chain of a transcript, in file order', async () => {
    const id = 'forked-g0'
    const workspace = write('fork.jsonl', [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: id,
        message: { content: text('one') },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: id,
        message: { content: text('two') },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'u1',
        sessionId: id,
        message: { content: text('branch') },
      },
      {
        type: 'user',
        uuid: 'u3',
        parentUuid: 'a2',
        sessionId: id,
        message: { content: text('three') },
      },
    ])
    expect((await run(['sessions', 'export', 'forked'], workspace)).out).toBe(
      'user: one\nassistant: two\nassistant: branch\nuser: three\n',
    )
  })

  it('reads string content, with or without uuids', async () => {
    const id = 'legacy-g0'
    const workspace = write('legacy.jsonl', [
      { type: 'user', sessionId: id, message: { content: 'plain question' } },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: id,
        message: { content: 'plain answer' },
      },
    ])
    const { code, out } = await run(['sessions', 'export', 'legacy'], workspace)
    expect(code).toBe(0)
    expect(out).toBe('user: plain question\nassistant: plain answer\n')
  })

  it('skips content it cannot read and goes on', async () => {
    const id = 'odd-g0'
    const workspace = write('odd.jsonl', [
      {
        type: 'user',
        sessionId: id,
        message: { content: [null, 7, { type: 'text', text: 'kept' }] },
      },
      { type: 'assistant', sessionId: id, message: { content: { not: 'an array' } } },
      { type: 'assistant', sessionId: id, message: null },
      { type: 'user', sessionId: id, message: { content: text('after') } },
    ])
    const { code, out } = await run(['sessions', 'export', 'odd'], workspace)
    expect(code).toBe(0)
    expect(out).toBe('user: kept\nuser: after\n')
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
