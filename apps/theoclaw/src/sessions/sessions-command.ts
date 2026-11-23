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

import { parseSessionsGcArgs, sessionsGcCommand } from '@theokit/agents/commands'
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

/** The user and assistant turns of a session, read by the framework; entries with no text are dropped. */
function readMessages(session: ChatSession): Message[] {
  const stored = readFullHistory({ transcript: session.transcript })
  // The CLI shows only what was said, not tool calls and results.
  return stored
    .map((entry) => ({
      role: entry.role,
      text: entry.parts.map((part) => (part.type === 'text' ? part.text : '')).join(''),
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
      `${JSON.stringify({ id: session.id, messages: readMessages(session) })}\n`,
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
  for (const message of readMessages(last))
    io.stdout.write(`${message.role}: ${message.text}\n`)
  return 0
}

/**
 * `sessions gc`: remove transcripts older than the retention that no chat uses. The command reads
 * the generations from `sessions.json`; it cannot see a retired generation a running daemon still
 * holds, which the daemon's own sweep protects, but such a transcript is being written and so is not old.
 */
async function gcCommand(args: readonly string[], io: SessionsIo): Promise<number> {
  // TheoClaw applies by default (`--dry-run` previews); `--days` is the retention in days.
  const parsed = parseSessionsGcArgs(args, { apply: true })
  if (!parsed.ok) throw new UsageError(`${USAGE_TEXT} (${parsed.message})`)
  // The retention is the age alone: the newest transcript always survives, so a keep bound has no meaning here.
  if (parsed.keepLast !== undefined)
    throw new UsageError(`${USAGE_TEXT} (--keep-last is not supported)`)
  const env: NodeJS.ProcessEnv = { ...io.env }
  const workspace = chatWorkspace(env, io)
  const days = parsed.maxAgeDays ?? readRetentionDays(env)
  const generations = Generations.load(sessionsFile(workspace))
  let errors: readonly string[] = []
  const outcome = await sessionsGcCommand({
    cwd: workspace,
    apply: parsed.apply,
    json: parsed.json,
    maxAgeDays: days,
    human: (_plan, result) => {
      const verb = result.dryRun ? 'would remove' : 'removed'
      return [
        ...result.removed.map((id) => `${verb} ${id}`),
        ...result.orphaned.map((path) => `${verb} ${path} (id unreadable)`),
        `${verb} ${result.removed.length + result.orphaned.length} transcripts older than ${days} days`,
      ]
    },
    run: async ({ apply }) => {
      const swept = await collectTranscripts({ workspace, generations }, days, apply)
      errors = swept.errors
      return {
        plan: { cwd: workspace, root: join(workspace, '.theoclaw'), candidates: [], kept: [] },
        result: {
          dryRun: swept.dryRun,
          removed: [...swept.removed],
          orphaned: [...swept.orphaned],
          errors: swept.errors.map((text) => {
            const at = text.indexOf(': ')
            return at < 0
              ? { id: undefined, message: text }
              : { id: text.slice(0, at), message: text.slice(at + 2) }
          }),
        },
      }
    },
  })
  for (const line of outcome.lines) io.stdout.write(`${line}\n`)
  // Errors stay on stderr, so stdout is only the report (or the one JSON line).
  for (const error of errors) io.stderr.write(`theoclaw: ${error}\n`)
  return outcome.failed > 0 ? 1 : 0
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
        `${entry.id}\t${(readMessages(entry)).length} messages\t${entry.modifiedAt.toISOString()}\n`,
      )
    }
    return 0
  }
  const wanted = operands[0]!
  const session = pickSession(sessions, wanted, io)
  if (session === undefined) return 1
  const messages = readMessages(session)
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
