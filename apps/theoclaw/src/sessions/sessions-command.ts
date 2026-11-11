import { closeSync, constants, existsSync, fchmodSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { listSessions } from '@theokit/agents/session'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { resolveInstance } from '../instance.js'

/**
 * `theoclaw sessions list|show|export` (OC-51): a read-only view over the chat transcripts the SDK
 * keeps under `<workspace>/.theoclaw/projects/<encoded workspace>/`. `show` prints a session's
 * summary, `export` its messages, one `role: text` block each, or JSON lines with `--json`.
 */

export interface SessionsIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
}

interface Message {
  readonly role: string
  readonly text: string
}

const USAGE_TEXT = 'theoclaw sessions: expected list | show <id> | export <id> [--json]'

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      const entry = block as { type?: unknown; text?: unknown }
      return entry?.type === 'text' && typeof entry.text === 'string' ? entry.text : ''
    })
    .join('')
}

/** The user and assistant turns of a transcript; tool results and system records carry no text. */
export function readMessages(file: string): Message[] {
  const messages: Message[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    let record: { type?: unknown; message?: { content?: unknown } }
    try {
      record = JSON.parse(line) as typeof record
    } catch {
      continue
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue
    const text = textOf(record.message?.content)
    if (text !== '') messages.push({ role: record.type, text })
  }
  return messages
}

type ChatSession = ReturnType<typeof listSessions>[number] & { id: string }

function listChatSessions(io: SessionsIo): ChatSession[] {
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const workspace =
    env.THEOCLAW_WORKSPACE?.trim() || resolveInstance(env, { homeDir: io.homeDir }).workspace
  if (workspace === undefined || workspace === '') {
    throw new TheoClawConfigError(
      'THEOCLAW_WORKSPACE must be set to the directory TheoClaw keeps its chat sessions in',
      { variable: 'THEOCLAW_WORKSPACE' },
    )
  }
  return listSessions(workspace, join(workspace, '.theoclaw')).filter(
    (entry): entry is ChatSession => entry.id !== undefined,
  )
}

function matchSession(sessions: readonly ChatSession[], wanted: string): ChatSession[] {
  const exact = sessions.filter((entry) => entry.id === wanted)
  return exact.length > 0 ? exact : sessions.filter((entry) => entry.id.startsWith(wanted))
}

function pickSession(
  sessions: readonly ChatSession[],
  wanted: string,
  io: SessionsIo,
): ChatSession | undefined {
  const found = matchSession(sessions, wanted)
  if (found.length !== 1) {
    io.stderr.write(
      `theoclaw: ${found.length === 0 ? 'no session' : 'more than one session'} matches ${wanted}\n`,
    )
    return undefined
  }
  return found[0]
}

function findSession(wanted: string, io: SessionsIo): ChatSession | string {
  const found = matchSession(listChatSessions(io), wanted)
  return found.length === 1
    ? found[0]!
    : `theoclaw: ${found.length === 0 ? 'no session' : 'more than one session'} matches ${wanted}\n`
}

const SHARE_USAGE = 'theoclaw sessions: expected share <id> --to <dir> | open <id> --from <dir>'
const SHARED_SUBDIR = 'shared-sessions'

function flagValue(args: readonly string[], flag: string): { value: string; operands: string[] } {
  const at = args.indexOf(flag)
  const value = at >= 0 ? args[at + 1] : undefined
  const operands = args.filter((_, index) => index !== at && index !== at + 1)
  if (
    value === undefined ||
    value.startsWith('-') ||
    operands.length !== 1 ||
    operands[0]!.startsWith('-')
  )
    throw new UsageError(SHARE_USAGE)
  return { value, operands }
}

/**
 * `sessions share` writes a read-only snapshot of a session into a directory another instance can
 * read; `sessions open` prints one. A snapshot has no verb that appends to it, so the receiving
 * instance can read it but never send into it.
 */
function shareCommand(verb: 'share' | 'open', args: readonly string[], io: SessionsIo): number {
  const { value: dir, operands } = flagValue(args, verb === 'share' ? '--to' : '--from')
  const wanted = operands[0]!
  const shared = join(dir, SHARED_SUBDIR)
  if (verb === 'open') {
    const names = existsSync(shared)
      ? readdirSync(shared).filter((name) => name.endsWith('.json'))
      : []
    const found = names.filter((name) => name === `${wanted}.json`)
    const matches = found.length > 0 ? found : names.filter((name) => name.startsWith(wanted))
    if (matches.length !== 1) {
      io.stderr.write(
        `theoclaw: ${matches.length === 0 ? 'no shared session' : 'more than one shared session'} matches ${wanted}\n`,
      )
      return 1
    }
    const snapshot = JSON.parse(readFileSync(join(shared, matches[0]!), 'utf8')) as {
      id: string
      messages: Message[]
    }
    io.stdout.write(`shared session ${snapshot.id} (read-only)\n`)
    for (const message of snapshot.messages) io.stdout.write(`${message.role}: ${message.text}\n`)
    return 0
  }
  const session = findSession(wanted, io)
  if (typeof session === 'string') {
    io.stderr.write(session)
    return 1
  }
  mkdirSync(shared, { recursive: true })
  const file = join(shared, `${session.id}.json`)
  // No check-then-use: drop any earlier copy (a read-only file, or a link planted in its place),
  // then create the file exclusively without following a link, and set its mode on the open handle.
  rmSync(file, { force: true })
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify({ id: session.id, messages: readMessages(session.transcript) })}\n`)
    fchmodSync(fd, 0o444)
  } finally {
    closeSync(fd)
  }
  io.stdout.write(`shared ${session.id} read-only to ${shared}\n`)
  return 0
}

/** `theoclaw resume`: prints the messages of the most recently updated chat session. */
export function resumeCommand(args: readonly string[], io: SessionsIo): number {
  if (args.length > 0) throw new UsageError('theoclaw resume: expected no arguments')
  const [last] = listChatSessions(io).sort(
    (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime(),
  )
  if (last === undefined) {
    io.stderr.write('theoclaw: no session to resume\n')
    return 1
  }
  io.stdout.write(`resuming session ${last.id}\n`)
  for (const message of readMessages(last.transcript))
    io.stdout.write(`${message.role}: ${message.text}\n`)
  return 0
}

export function sessionsCommand(args: readonly string[], io: SessionsIo): number {
  const [verb, ...rest] = args
  if (verb === 'share' || verb === 'open') return shareCommand(verb, rest, io)
  const json = rest.includes('--json')
  const operands = rest.filter((arg) => arg !== '--json')
  const wantsId = verb === 'show' || verb === 'export'
  if (
    !(verb === 'list' && operands.length === 0 && !json) &&
    !(
      wantsId &&
      operands.length === 1 &&
      !operands[0]!.startsWith('-') &&
      (verb === 'export' || !json)
    )
  ) {
    throw new UsageError(USAGE_TEXT)
  }
  const sessions = listChatSessions(io)
  if (verb === 'list') {
    for (const entry of sessions) {
      io.stdout.write(
        `${entry.id}\t${readMessages(entry.transcript).length} messages\t${entry.modifiedAt.toISOString()}\n`,
      )
    }
    return 0
  }
  const wanted = operands[0]!
  const session = pickSession(sessions, wanted, io)
  if (session === undefined) return 1
  const messages = readMessages(session.transcript)
  if (verb === 'show') {
    io.stdout.write(
      `id: ${session.id}\nmessages: ${messages.length}\nupdated: ${session.modifiedAt.toISOString()}\n`,
    )
  } else if (json) {
    for (const message of messages) io.stdout.write(`${JSON.stringify(message)}\n`)
  } else {
    for (const message of messages) io.stdout.write(`${message.role}: ${message.text}\n`)
  }
  return 0
}
