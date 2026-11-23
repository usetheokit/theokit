import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { listSessions } from '@theokit/agents/session'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { resolveInstance } from '../instance.js'
import { sessionsFile } from './chat-sessions.js'
import { Generations } from './generations.js'
import { readRetentionDays } from './session-settings.js'
import { collectTranscripts } from './transcript-gc.js'
import { readFullHistory } from './transcript-history.js'

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

const USAGE_TEXT = 'theoclaw sessions: expected list | show <id> | export <id> [--json] | gc [--dry-run] [--days <n>]'

/** The user and assistant turns of a session, read by the SDK; entries with no text are dropped. */
async function readMessages(session: ChatSession): Promise<Message[]> {
  const stored = await readFullHistory({
    cwd: session.workspace,
    transcript: session.transcript,
  })
  // The reader's `text` also renders tool calls and results; the CLI shows only what was said.
  return stored
    .map((entry) => ({
      role: entry.role,
      text: (entry.parts ?? []).map((part) => (part.type === 'text' ? part.text : '')).join(''),
    }))
    .filter((entry) => entry.text !== '')
}

type ChatSession = Awaited<ReturnType<typeof listSessions>>[number] & {
  id: string
  workspace: string
}

function chatWorkspace(env: NodeJS.ProcessEnv, io: SessionsIo): string {
  loadConfiguration(env, io.homeDir)
  const workspace =
    env.THEOCLAW_WORKSPACE?.trim() || resolveInstance(env, { homeDir: io.homeDir }).workspace
  if (workspace === undefined || workspace === '') {
    throw new TheoClawConfigError(
      'THEOCLAW_WORKSPACE must be set to the directory TheoClaw keeps its chat sessions in',
      { variable: 'THEOCLAW_WORKSPACE' },
    )
  }
  return workspace
}

async function listChatSessions(io: SessionsIo): Promise<ChatSession[]> {
  const workspace = chatWorkspace({ ...io.env }, io)
  const listed = await listSessions(workspace, join(workspace, '.theoclaw'))
  return listed.flatMap((entry) =>
    entry.id === undefined ? [] : [{ ...entry, id: entry.id, workspace }],
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

async function findSession(wanted: string, io: SessionsIo): Promise<ChatSession | string> {
  const found = matchSession(await listChatSessions(io), wanted)
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
async function shareCommand(
  verb: 'share' | 'open',
  args: readonly string[],
  io: SessionsIo,
): Promise<number> {
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
  const session = await findSession(wanted, io)
  if (typeof session === 'string') {
    io.stderr.write(session)
    return 1
  }
  mkdirSync(shared, { recursive: true })
  const file = join(shared, `${session.id}.json`)
  // No check-then-use: drop any earlier copy (a read-only file, or a link planted in its place),
  // then create the file exclusively without following a link, and set its mode on the open handle.
  rmSync(file, { force: true })
  const fd = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({ id: session.id, messages: await readMessages(session) })}\n`,
    )
    fchmodSync(fd, 0o444)
  } finally {
    closeSync(fd)
  }
  io.stdout.write(`shared ${session.id} read-only to ${shared}\n`)
  return 0
}

/** `theoclaw resume`: prints the messages of the most recently updated chat session. */
export async function resumeCommand(args: readonly string[], io: SessionsIo): Promise<number> {
  if (args.length > 0) throw new UsageError('theoclaw resume: expected no arguments')
  const [last] = (await listChatSessions(io)).sort(
    (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime(),
  )
  if (last === undefined) {
    io.stderr.write('theoclaw: no session to resume\n')
    return 1
  }
  io.stdout.write(`resuming session ${last.id}\n`)
  for (const message of await readMessages(last))
    io.stdout.write(`${message.role}: ${message.text}\n`)
  return 0
}

/**
 * `sessions gc`: remove transcripts older than the retention that no chat uses. The command reads
 * the generations from `sessions.json`; it cannot see a retired generation a running daemon still
 * holds, which the daemon's own sweep protects, but such a transcript is being written and so is not old.
 */
async function gcCommand(args: readonly string[], io: SessionsIo): Promise<number> {
  const dryRun = args.includes('--dry-run')
  const rest = args.filter((arg) => arg !== '--dry-run')
  const at = rest.indexOf('--days')
  const daysText = at >= 0 ? rest[at + 1] : undefined
  const left = rest.filter((_, index) => at < 0 || (index !== at && index !== at + 1))
  if (
    left.length > 0 ||
    (at >= 0 && (daysText === undefined || !/^\d+$/.test(daysText) || Number(daysText) < 1))
  )
    throw new UsageError(USAGE_TEXT)
  const env: NodeJS.ProcessEnv = { ...io.env }
  const workspace = chatWorkspace(env, io)
  const days = daysText === undefined ? readRetentionDays(env) : Number(daysText)
  const result = await collectTranscripts(
    { workspace, generations: Generations.load(sessionsFile(workspace)) },
    days,
    !dryRun,
  )
  const verb = dryRun ? 'would remove' : 'removed'
  for (const id of result.removed) io.stdout.write(`${verb} ${id}\n`)
  for (const path of result.orphaned) io.stdout.write(`${verb} ${path} (id unreadable)\n`)
  for (const error of result.errors) io.stderr.write(`theoclaw: ${error}\n`)
  const total = result.removed.length + result.orphaned.length
  io.stdout.write(`${verb} ${total} transcripts older than ${days} days\n`)
  return result.errors.length > 0 ? 1 : 0
}

export async function sessionsCommand(args: readonly string[], io: SessionsIo): Promise<number> {
  const [verb, ...rest] = args
  if (verb === 'gc') return gcCommand(rest, io)
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
  const sessions = await listChatSessions(io)
  if (verb === 'list') {
    for (const entry of sessions) {
      io.stdout.write(
        `${entry.id}\t${(await readMessages(entry)).length} messages\t${entry.modifiedAt.toISOString()}\n`,
      )
    }
    return 0
  }
  const wanted = operands[0]!
  const session = pickSession(sessions, wanted, io)
  if (session === undefined) return 1
  const messages = await readMessages(session)
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
