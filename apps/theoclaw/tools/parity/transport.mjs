/**
 * The transport interface the channel issues implement (#1591):
 *
 *   send(turn): Promise<void>
 *   awaitReply(match: RegExp, timeoutMs: number): Promise<{ text: string, matched: boolean, failed: boolean, raw: unknown }>
 *
 * `awaitReply` resolves with the reply collected so far when the deadline passes or the turn ends;
 * `matched` says whether `match` hit the text; `failed` says the surface reported an error.
 */
import { spawn } from 'node:child_process'

import WebSocket from 'ws'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) await sleep(100)
  return condition()
}

const frameEvent = (frame) => (frame.type === 'event' ? frame.event : undefined)
const isFinalFrame = (frame) => frame.type === 'done' || (frame.type === 'error' && frame.code === 'turn_failed')

export function controlTransport({ port, token }) {
  const frames = []
  let socket
  return {
    async send(turn) {
      socket = new WebSocket(`ws://127.0.0.1:${port}/control`, { headers: { Authorization: `Bearer ${token}` } })
      socket.on('message', (raw) => frames.push(JSON.parse(String(raw))))
      await new Promise((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      socket.send(JSON.stringify({ type: 'chat', message: turn.message }))
    },
    async awaitReply(match, timeoutMs) {
      await until(() => frames.some(isFinalFrame), timeoutMs)
      socket?.close()
      const text = frames
        .map(frameEvent)
        .filter((e) => e?.type === 'text_delta' && typeof e.content === 'string')
        .map((e) => e.content)
        .join('')
      const final = frames.find(isFinalFrame)
      return { text, matched: match.test(text), failed: final === undefined || final.type !== 'done', raw: frames }
    },
  }
}

export function webchatTransport({ base, token }) {
  let client
  return {
    async send(turn) {
      const { AgentClient, HttpTransport } = await import('@theokit/agents/client')
      client = new AgentClient(new HttpTransport({ api: `${base}/webchat/chat`, headers: { Authorization: `Bearer ${token}` } }))
      client.send({ message: turn.message })
    },
    async awaitReply(match, timeoutMs) {
      const running = () => client.getSnapshot().status === 'streaming' || client.getSnapshot().status === 'idle'
      await until(() => !running(), timeoutMs)
      const snapshot = client.getSnapshot()
      const text = snapshot.thread
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.parts)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      return { text, matched: match.test(text), failed: snapshot.status !== 'done', raw: snapshot.thread }
    },
  }
}

/** Runs each command of the turn as a `dist/cli.js` subprocess; the reply is the last one's output. */
export function cliTransport({ entry, env, home, model }) {
  const results = []
  let finished = false
  const expand = (arg) => arg.replaceAll('$HOME', home).replaceAll('$MODEL', model)
  return {
    async send(turn) {
      for (const command of turn.commands) {
        const child = spawn(process.execPath, [entry, ...command.map(expand)], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', (chunk) => (output += chunk))
        child.stderr.on('data', (chunk) => (output += chunk))
        const code = await new Promise((resolve) => child.once('close', (c) => resolve(c ?? 1)))
        results.push({ command: command[0], code, output })
        if (code !== 0) break
      }
      finished = true
    },
    async awaitReply(match, timeoutMs) {
      await until(() => finished, timeoutMs)
      const last = results.at(-1)
      const text = last?.output ?? ''
      return { text, matched: match.test(text), failed: last === undefined || results.some((r) => r.code !== 0), raw: results }
    },
  }
}
