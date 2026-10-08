#!/usr/bin/env node
/**
 * A minimal ACP agent process that enforces the session handshake the protocol requires.
 *
 * It speaks newline-delimited JSON-RPC on stdio, like any ACP agent, and refuses what a real
 * agent refuses: a "session/new" before "initialize", and a "session/prompt" that names no
 * session it created (the sibling `@theokit/acp` server answers that case with -32001). The
 * agent's reply text arrives the way ACP delivers it, as a "session/update" notification
 * carrying an `agent_message_chunk`, and the prompt response itself carries only `stopReason`.
 */
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

let initialized = false
const sessions = new Set()
// `--refuse=<method>` makes the agent answer that method with an error that does not name it, so
// a caller can only report which step failed by adding the method itself.
const flag = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length)
const refused = flag('refuse')
// `--exit-on=<method>` exits with code 3 on receiving that method, an agent dying mid-turn.
const exitOn = flag('exit-on')
// `--silent-on=<method>` never answers that method, an agent that is stuck.
const silentOn = flag('silent-on')
// `--pid-file=<path>` writes this process's pid there, so a test can check it is gone afterwards.
const pidFile = flag('pid-file')
if (pidFile) writeFileSync(pidFile, String(process.pid))
// `--banner=<text>` writes that plain-text line to stdout at startup, the way a CLI prints a
// version banner or a warning on the channel that carries the protocol.
const banner = flag('banner')
if (banner !== undefined) process.stdout.write(`${banner}\n`)
// `--split-writes` writes every message in two writes split inside its first multibyte character,
// so the reader receives the two halves of that character in separate chunks.
const splitWrites = process.argv.includes('--split-writes')
// `--ignore-sigterm` keeps running on SIGTERM, an agent that does not cooperate with its stop.
if (process.argv.includes('--ignore-sigterm')) process.on('SIGTERM', () => undefined)

/** Writes still in flight, so a split message is never overtaken by the one sent after it. */
let pending = Promise.resolve()

/** Write `bytes` in two writes, the first ending inside the first multibyte character. */
function writeSplit(bytes) {
  const lead = bytes.findIndex((byte) => byte >= 0x80)
  if (lead === -1) return process.stdout.write(bytes)
  process.stdout.write(bytes.subarray(0, lead + 1))
  return new Promise((resolve) => {
    setTimeout(() => process.stdout.write(bytes.subarray(lead + 1), resolve), 50)
  })
}

function send(message) {
  const line = `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`
  if (!splitWrites) return process.stdout.write(line)
  pending = pending.then(() => writeSplit(Buffer.from(line, 'utf8')))
}

function fail(id, code, message) {
  send({ id, error: { code, message } })
}

function initialize(id, params) {
  if (typeof params?.protocolVersion !== 'number') {
    return fail(id, -32602, 'initialize requires a numeric protocolVersion')
  }
  initialized = true
  return send({ id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } })
}

function newSession(id, params) {
  if (typeof params?.cwd !== 'string') return fail(id, -32602, 'session/new requires cwd')
  const sessionId = `session-${sessions.size + 1}`
  sessions.add(sessionId)
  return send({ id, result: { sessionId } })
}

function prompt(id, params) {
  if (!sessions.has(params?.sessionId)) {
    return fail(id, -32001, `unknown session: ${String(params?.sessionId)}`)
  }
  const blocks = Array.isArray(params.prompt) ? params.prompt : []
  const text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('')
  if (text.length === 0) return fail(id, -32602, 'prompt carries no text block')
  send({
    method: 'session/update',
    params: {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `echo:${text}` },
      },
    },
  })
  return send({ id, result: { stopReason: 'end_turn' } })
}

/** The methods this agent answers; anything else is `method not found`. */
const HANDLERS = new Map([
  ['initialize', initialize],
  ['session/new', newSession],
  ['session/prompt', prompt],
])

function onRequest({ id, method, params }) {
  if (method === refused) return fail(id, -32602, 'invalid params')
  if (method !== 'initialize' && !initialized)
    return fail(id, -32000, `${method} before initialize`)
  const handler = HANDLERS.get(method)
  if (handler === undefined) return fail(id, -32601, `method not found: ${method}`)
  return handler(id, params)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().length === 0) return
  const message = JSON.parse(line)
  if (typeof message.id !== 'number' || typeof message.method !== 'string') return
  if (message.method === exitOn) process.exit(3)
  if (message.method !== silentOn) onRequest(message)
})
