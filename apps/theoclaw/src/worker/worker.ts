import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import type { ControlClient } from '../control-client/control-client.js'
import type { TurnAgent } from '../agent-port.js'
import { describeError } from '../control-plane/errors.js'

/**
 * `theoclaw worker pair <control url> <setup code> [--name <n>] [--inference worker|gateway]` and
 * `theoclaw worker run <message>` (OC-124): a paired worker device. Its profile is stored as
 * `<THEOCLAW_STATE_DIR>/worker.json`. With `inference: "worker"` the model call runs on this
 * device, on its own model key, and the provider request is recorded in the worker's own
 * `worker.log`; with `inference: "gateway"` the message is proxied to the gateway's `/control`
 * socket with the device token and the gateway makes the call.
 */

export type Inference = 'worker' | 'gateway'

export interface WorkerProfile {
  readonly url: string
  readonly token: string
  readonly name: string
  readonly inference: Inference
}

export interface WorkerIo {
  readonly env: NodeJS.ProcessEnv
  readonly stdout: Writable
  readonly stderr: Writable
  /** Tests inject a fake agent factory; the process builds the real one. */
  readonly agentFactory?: () => Promise<TurnAgent>
  readonly fetch?: typeof fetch
}

const USAGE_TEXT =
  'theoclaw worker: expected pair <control url> <setup code> [--name <n>] [--inference worker|gateway] | run <message> | status'

function stateDir(env: NodeJS.ProcessEnv): string {
  const dir = env.THEOCLAW_STATE_DIR?.trim()
  if (dir === undefined || dir === '')
    throw new UsageError('theoclaw worker: THEOCLAW_STATE_DIR is not set')
  return dir
}

const profilePath = (env: NodeJS.ProcessEnv): string => join(stateDir(env), 'worker.json')
export const workerLogPath = (env: NodeJS.ProcessEnv): string => join(stateDir(env), 'worker.log')

export function readWorkerProfile(env: NodeJS.ProcessEnv): WorkerProfile {
  const path = profilePath(env)
  if (!existsSync(path))
    throw new UsageError('theoclaw worker: this device is not paired; run worker pair first')
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkerProfile>
  if (
    typeof parsed.url !== 'string' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.name !== 'string' ||
    (parsed.inference !== 'worker' && parsed.inference !== 'gateway')
  )
    throw new UsageError(`theoclaw worker: ${path} is not a worker profile; pair again`)
  return parsed as WorkerProfile
}

function takeOption(flag: string, args: readonly string[]): { value?: string; rest: string[] } {
  const at = args.indexOf(flag)
  if (at < 0) return { rest: [...args] }
  const value = args[at + 1]
  if (value === undefined || value.startsWith('-'))
    throw new UsageError(`theoclaw worker: ${flag} expects a value`)
  return { value, rest: args.filter((_, i) => i !== at && i !== at + 1) }
}

async function pair(args: readonly string[], io: WorkerIo): Promise<number> {
  const named = takeOption('--name', args)
  const inf = takeOption('--inference', named.rest)
  const [url, code, ...extra] = inf.rest
  if (url === undefined || code === undefined || extra.length > 0) throw new UsageError(USAGE_TEXT)
  const inference = inf.value ?? 'worker'
  if (inference !== 'worker' && inference !== 'gateway')
    throw new UsageError('theoclaw worker: --inference expects worker or gateway')
  let base: URL
  try {
    base = new URL(url)
  } catch {
    throw new UsageError('theoclaw worker: the control url is not a URL')
  }
  const name = named.value ?? `worker-${randomBytes(3).toString('hex')}`
  const token = randomBytes(32).toString('hex')
  const pairUrl = new URL('/control/pair', base)
  pairUrl.protocol =
    base.protocol === 'wss:' ? 'https:' : base.protocol === 'ws:' ? 'http:' : base.protocol
  const response = await (io.fetch ?? fetch)(pairUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, token }),
  })
  if (response.status !== 202) {
    io.stderr.write(`theoclaw worker: the gateway refused the pairing: HTTP ${response.status}\n`)
    return 1
  }
  const socket = new URL('/control', base)
  socket.protocol = pairUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const profile: WorkerProfile = { url: socket.toString(), token, name, inference }
  mkdirSync(stateDir(io.env), { recursive: true, mode: 0o700 })
  writeFileSync(profilePath(io.env), JSON.stringify(profile, null, 2), { mode: 0o600 })
  chmodSync(profilePath(io.env), 0o600)
  io.stdout.write(
    `theoclaw worker: ${name} is waiting for the owner's approval (inference: ${inference})\n`,
  )
  return 0
}

function logLine(env: NodeJS.ProcessEnv, line: string): void {
  appendFileSync(workerLogPath(env), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 })
}

/** The model call on this device; its provider request goes to the worker's own log. */
async function runLocal(message: string, profile: WorkerProfile, io: WorkerIo): Promise<number> {
  const create =
    io.agentFactory ??
    (async () => (await import('../control-plane/agent-factory.js')).createAgentFactory(io.env)())
  const agent = await create()
  try {
    logLine(
      io.env,
      `provider request: model=${io.env.THEOCLAW_MODEL ?? 'unset'} device=${profile.name} inference=worker`,
    )
    const run = await agent.send(message)
    for await (const event of run.stream()) {
      const text = (event as { type: string; text?: unknown }).text
      if (event.type === 'text-delta' && typeof text === 'string') io.stdout.write(text)
    }
    const end = await run.wait()
    io.stdout.write('\n')
    logLine(io.env, `provider response: status=${end.status}`)
    return end.status === 'finished' || end.status === 'completed' ? 0 : 1
  } finally {
    await (agent as unknown as { dispose?: () => Promise<void> }).dispose?.()
  }
}

/** The model call proxied to the gateway, which makes it; nothing is written to the worker's log. */
async function runProxied(message: string, profile: WorkerProfile, io: WorkerIo): Promise<number> {
  const { createControlClient } = await import('../control-client/control-client.js')
  const client: ControlClient = await createControlClient({
    url: profile.url,
    token: profile.token,
  })
  try {
    for await (const frame of client.chat(message, `worker-${profile.name}`)) {
      if (frame.type === 'error') {
        io.stderr.write(`theoclaw worker: the gateway answered ${frame.code}\n`)
        return 1
      }
      if (frame.type === 'event') {
        const event = frame.event as { type?: string; text?: unknown }
        if (typeof event.text === 'string') io.stdout.write(event.text)
      }
    }
    io.stdout.write('\n')
    return 0
  } finally {
    await client.close()
  }
}

export async function workerCommand(args: readonly string[], io: WorkerIo): Promise<number> {
  const [verb, ...rest] = args
  if (verb === 'pair') return pair(rest, io)
  if (verb === 'status' && rest.length === 0) {
    const p = readWorkerProfile(io.env)
    io.stdout.write(`${p.name}\t${p.url}\tinference: ${p.inference}\n`)
    return 0
  }
  if (verb === 'run' && rest.length > 0) {
    const profile = readWorkerProfile(io.env)
    const message = rest.join(' ')
    try {
      return profile.inference === 'worker'
        ? await runLocal(message, profile, io)
        : await runProxied(message, profile, io)
    } catch (error) {
      io.stderr.write(`theoclaw worker: ${describeError(error)}\n`)
      return 1
    }
  }
  throw new UsageError(USAGE_TEXT)
}
