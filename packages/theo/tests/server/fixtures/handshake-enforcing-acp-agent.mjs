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
import { createInterface } from 'node:readline'

let initialized = false
const sessions = new Set()

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

function fail(id, code, message) {
  send({ id, error: { code, message } })
}

function onRequest({ id, method, params }) {
  if (method === 'initialize') {
    if (typeof params?.protocolVersion !== 'number') {
      return fail(id, -32602, 'initialize requires a numeric protocolVersion')
    }
    initialized = true
    return send({ id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } })
  }
  if (!initialized) return fail(id, -32000, `${method} before initialize`)
  if (method === 'session/new') {
    if (typeof params?.cwd !== 'string') return fail(id, -32602, 'session/new requires cwd')
    const sessionId = `session-${sessions.size + 1}`
    sessions.add(sessionId)
    return send({ id, result: { sessionId } })
  }
  if (method === 'session/prompt') {
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
  return fail(id, -32601, `method not found: ${method}`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().length === 0) return
  const message = JSON.parse(line)
  if (typeof message.id === 'number' && typeof message.method === 'string') onRequest(message)
})
