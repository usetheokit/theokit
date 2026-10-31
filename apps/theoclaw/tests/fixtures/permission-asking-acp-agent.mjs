#!/usr/bin/env node
/**
 * An ACP agent over stdio that asks one permission per prompt and records the answer.
 *
 * It answers `initialize`, `session/new` and `session/prompt` as an ACP v1 agent does. Before it
 * answers a prompt it sends `session/request_permission` with an `allow_once` and a `reject_once`
 * option, appends the client's answer (the selected `optionId`, or `cancelled`) as one line to the
 * `--record=<file>` file, streams one `agent_message_chunk` and ends the turn with `end_turn`.
 *
 * `--pid-file=<path>` writes this process's pid there, `--token=<text>` is the text it streams
 * (default `done`), `--exit-on=<method>` exits with code 3 on that method and `--silent-on=<method>`
 * never answers it. It writes nothing to stderr: the transport inherits the parent's stderr.
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const flag = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length)
const record = flag('record')
const pidFile = flag('pid-file')
const token = flag('token') ?? 'done'
const exitOn = flag('exit-on')
const silentOn = flag('silent-on')
if (pidFile !== undefined) writeFileSync(pidFile, String(process.pid))

let nextId = 1000
/** Answers the client owes this agent, by the id of the request the agent sent. */
const awaiting = new Map()

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

function ask(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise((resolve) => awaiting.set(id, resolve))
}

async function prompt(id, params) {
  const answer = await ask('session/request_permission', {
    sessionId: params.sessionId,
    toolCall: { toolCallId: 'call-1', title: 'write a file', kind: 'edit' },
    options: [
      { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
  })
  const outcome = answer?.outcome
  const line = outcome?.outcome === 'selected' ? outcome.optionId : String(outcome?.outcome)
  if (record !== undefined) appendFileSync(record, `${line}\n`)
  send({
    method: 'session/update',
    params: {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: token } },
    },
  })
  send({ id, result: { stopReason: 'end_turn' } })
}

const HANDLERS = {
  initialize: (id) => send({ id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } }),
  'session/new': (id) => send({ id, result: { sessionId: 'session-1' } }),
  'session/prompt': (id, params) => void prompt(id, params),
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return
  const message = JSON.parse(line)
  if (message.method === undefined && awaiting.has(message.id)) {
    awaiting.get(message.id)(message.result)
    awaiting.delete(message.id)
    return
  }
  if (message.method === exitOn) process.exit(3)
  if (message.method === silentOn) return
  const handler = HANDLERS[message.method]
  if (handler === undefined) send({ id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
  else handler(message.id, message.params)
})
