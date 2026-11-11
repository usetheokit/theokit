import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { chromeMeetingTransport } from './chrome-transport.js'

/**
 * `theoclaw meetings join <link> [--minutes <n>] | list | show <id>` (OC-16): the agent joins a
 * Google Meet link as a guest in a headless Chrome, keeps the live captions as notes for as long as
 * the meeting runs (or `--minutes`), and stores them as `<THEOCLAW_STATE_DIR>/meetings/<id>/` (a
 * `meeting.json` and `notes.md`). `list` and `show` read the stored notes back.
 */

export interface MeetingsIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly stdout: Writable
  readonly stderr: Writable
  /** The browser side; tests inject a fake, the process uses headless Chrome. */
  readonly transport?: MeetingTransport
  readonly now?: () => Date
}

export interface MeetingTransport {
  /** Joins `url`, calls `onLine` for each spoken line, and resolves when the meeting ends or `maxMs` passes. */
  join(
    url: string,
    options: { readonly maxMs: number; readonly onLine: (speaker: string, text: string) => void },
  ): Promise<void>
}

export interface MeetingRecord {
  readonly id: string
  readonly url: string
  readonly startedAt: string
  readonly endedAt: string
  readonly lines: number
}

const MEET = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/
const USAGE_TEXT = 'theoclaw meetings: expected join <meet link> [--minutes <n>] | list | show <id>'

function meetingsDir(env: Readonly<Record<string, string | undefined>>): string {
  const state = env.THEOCLAW_STATE_DIR?.trim()
  if (state === undefined || state === '')
    throw new UsageError('theoclaw meetings: THEOCLAW_STATE_DIR is not set')
  return join(state, 'meetings')
}

export function listMeetings(env: Readonly<Record<string, string | undefined>>): MeetingRecord[] {
  const dir = meetingsDir(env)
  if (!existsSync(dir)) return []
  const records: MeetingRecord[] = []
  for (const name of readdirSync(dir).sort()) {
    try {
      records.push(
        JSON.parse(readFileSync(join(dir, name, 'meeting.json'), 'utf8')) as MeetingRecord,
      )
    } catch {
      continue
    }
  }
  return records
}

async function join_(args: readonly string[], io: MeetingsIo): Promise<number> {
  const [url, ...rest] = args
  if (url === undefined || !MEET.test(url))
    throw new UsageError(
      'theoclaw meetings join: expected a https://meet.google.com/abc-defg-hij link',
    )
  let minutes = 120
  if (rest.length > 0) {
    const value = Number(rest[1])
    if (rest.length !== 2 || rest[0] !== '--minutes' || !Number.isFinite(value) || value <= 0) {
      throw new UsageError('theoclaw meetings join: expected <link> [--minutes <n>]')
    }
    minutes = value
  }
  const dir = meetingsDir(io.env)
  const now = io.now ?? ((): Date => new Date())
  const startedAt = now()
  const id =
    startedAt.toISOString().replace(/\W/g, '').slice(0, 15) +
    '-' +
    url.slice(-12).replace(/\W/g, '')
  const notes: string[] = []
  await (io.transport ?? chromeMeetingTransport(io.env)).join(url, {
    maxMs: minutes * 60_000,
    onLine: (speaker, text) => notes.push(`**${speaker}:** ${text}`),
  })
  const record: MeetingRecord = {
    id,
    url,
    startedAt: startedAt.toISOString(),
    endedAt: now().toISOString(),
    lines: notes.length,
  }
  mkdirSync(join(dir, id), { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, id, 'notes.md'), `# Meeting ${url}\n\n${notes.join('\n\n')}\n`, {
    mode: 0o600,
  })
  writeFileSync(join(dir, id, 'meeting.json'), JSON.stringify(record, null, 2), { mode: 0o600 })
  io.stdout.write(`${id}\n`)
  return 0
}

export function meetingsCommand(args: readonly string[], io: MeetingsIo): Promise<number> {
  const [verb, ...rest] = args
  if (verb === 'join') return join_(rest, io)
  if (verb === 'list' && rest.length === 0) {
    for (const m of listMeetings(io.env))
      io.stdout.write(`${m.id}\t${m.startedAt}\t${m.lines} lines\t${m.url}\n`)
    return Promise.resolve(0)
  }
  if (verb === 'show' && rest.length === 1) {
    const matches = listMeetings(io.env).filter((m) => m.id.startsWith(rest[0]!))
    if (matches.length !== 1)
      throw new UsageError(
        `theoclaw meetings: ${matches.length === 0 ? 'no meeting' : 'several meetings'} match "${rest[0]}"`,
      )
    io.stdout.write(readFileSync(join(meetingsDir(io.env), matches[0]!.id, 'notes.md'), 'utf8'))
    return Promise.resolve(0)
  }
  throw new UsageError(USAGE_TEXT)
}
