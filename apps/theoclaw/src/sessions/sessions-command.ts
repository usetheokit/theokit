import { readFileSync } from 'node:fs'
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

export function sessionsCommand(args: readonly string[], io: SessionsIo): number {
  const [verb, ...rest] = args
  const json = rest.includes('--json')
  const operands = rest.filter((arg) => arg !== '--json')
  const wantsId = verb === 'show' || verb === 'export'
  if (!(verb === 'list' && operands.length === 0 && !json) && !(wantsId && operands.length === 1 && !operands[0]!.startsWith('-') && (verb === 'export' || !json))) {
    throw new UsageError(USAGE_TEXT)
  }
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const workspace = env.THEOCLAW_WORKSPACE?.trim() || resolveInstance(env, { homeDir: io.homeDir }).workspace
  if (workspace === undefined || workspace === '') {
    throw new TheoClawConfigError('THEOCLAW_WORKSPACE must be set to the directory TheoClaw keeps its chat sessions in', { variable: 'THEOCLAW_WORKSPACE' })
  }
  const sessions = listSessions(workspace, join(workspace, '.theoclaw')).filter((entry) => entry.id !== undefined)
  if (verb === 'list') {
    for (const entry of sessions) {
      io.stdout.write(`${entry.id}\t${readMessages(entry.transcript).length} messages\t${entry.modifiedAt.toISOString()}\n`)
    }
    return 0
  }
  const wanted = operands[0]!
  const exact = sessions.filter((entry) => entry.id === wanted)
  const found = exact.length > 0 ? exact : sessions.filter((entry) => entry.id!.startsWith(wanted))
  if (found.length !== 1) {
    io.stderr.write(`theoclaw: ${found.length === 0 ? 'no session' : 'more than one session'} matches ${wanted}\n`)
    return 1
  }
  const session = found[0]!
  const messages = readMessages(session.transcript)
  if (verb === 'show') {
    io.stdout.write(`id: ${session.id}\nmessages: ${messages.length}\nupdated: ${session.modifiedAt.toISOString()}\n`)
  } else if (json) {
    for (const message of messages) io.stdout.write(`${JSON.stringify(message)}\n`)
  } else {
    for (const message of messages) io.stdout.write(`${message.role}: ${message.text}\n`)
  }
  return 0
}
