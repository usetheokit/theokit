/**
 * The OpenClaw side of the parity harness (#1673): installs a pinned OpenClaw into a scratch
 * directory, points it at the same `openai-chatgpt/` model as theoclaw and runs one scenario turn.
 * `/control` scenarios use `openclaw agent --message` against its gateway; `cli` scenarios run the
 * same commands through its CLI.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { cliTransport } from './transport.mjs'

// Verified against openclaw@2026.11.3 (npm view, install, `gateway`, `agent --help`, `models auth list --json`).
export const OPENCLAW_VERSION = '2026.11.3'
export const SUBSCRIPTION_PREFIX = 'openai-chatgpt/'
export const OPENCLAW_SURFACES = ['control', 'cli']
const TURN_TIMEOUT_MS = 120_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** OpenClaw's own auth store, relative to its state directory (`models auth list --json` prints `authStatePath`). */
const AUTH_STORE = join('agents', 'main', 'agent', 'openclaw-agent.sqlite')

/** The directory whose `.theokit/auth.json` holds theoclaw's subscription login. */
export function authHome(env) {
  return env.THEOKIT_AUTH_HOME || env.HOME || homedir()
}

export function loginFile(env) {
  return join(authHome(env), '.theokit', 'auth.json')
}

/** OpenClaw's state directory on this machine: `OPENCLAW_STATE_DIR`, else `~/.openclaw`. */
export function openclawStateDir(env) {
  return env.OPENCLAW_STATE_DIR || join(env.HOME || homedir(), '.openclaw')
}

/** True when `version` (like `v26.13.1`) can run the pinned OpenClaw: 24.22.1+ below 25, or 26.12.1+. */
export function nodeSupportsOpenclaw(version) {
  const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number)
  const atLeast = (n, p) => minor > n || (minor === n && patch >= p)
  if (major === 24) return atLeast(22, 1)
  return major > 26 || (major === 26 && atLeast(12, 1))
}

/** What a run lacks before either product can start; empty when nothing is. `side` is `openclaw` or `both`. */
export function missingSubscription(env, side = 'both') {
  const missing = []
  const model = env.THEOCLAW_PARITY_MODEL
  if (!model) missing.push('THEOCLAW_PARITY_MODEL is not set')
  else if (!model.startsWith(SUBSCRIPTION_PREFIX)) missing.push(`THEOCLAW_PARITY_MODEL must be an ${SUBSCRIPTION_PREFIX}... model so both products use the subscription route`)
  if (side === 'both' && !existsSync(loginFile(env))) missing.push(`the theoclaw ChatGPT subscription login (${loginFile(env)} is missing)`)
  const store = join(openclawStateDir(env), AUTH_STORE)
  if (!existsSync(store)) missing.push(`the OpenClaw ChatGPT subscription login (${store} is missing; run openclaw models auth login --provider openai-chatgpt)`)
  if (!nodeSupportsOpenclaw(process.version)) missing.push(`Node 24.22.1+ or 26.12.1+ for OpenClaw (running ${process.version})`)
  return missing
}

function run(command, args, options) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

/** The environment every OpenClaw process gets: the scratch state, and this Node first on PATH. */
function openclawEnv(root, token) {
  const state = join(root, 'state')
  return {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    HOME: join(root, 'home'),
    OPENCLAW_STATE_DIR: state,
    OPENCLAW_CONFIG_PATH: join(state, 'openclaw.json'),
    ...(token === undefined ? {} : { OPENCLAW_GATEWAY_TOKEN: token }),
  }
}

/** Installs OpenClaw into `root` and returns its entry script and installed version. */
export function installOpenclaw(root, env, exec = run) {
  const out = exec('npm', ['install', '--no-audit', '--no-fund', '--prefix', root, `openclaw@${OPENCLAW_VERSION}`], { env: openclawEnv(root) })
  if (out.status !== 0) throw new Error(`npm install openclaw@${OPENCLAW_VERSION} failed: ${String(out.stderr ?? '').slice(-500)}`)
  const pkgDir = join(root, 'node_modules', 'openclaw')
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  return { entry: join(pkgDir, pkg.bin?.openclaw ?? 'openclaw.mjs'), version: pkg.version }
}

/** Writes the OpenClaw config into the scratch state dir and copies the user's own OpenClaw login (its auth store) there. */
export function configureOpenclaw(root, env, model, token, port) {
  const state = join(root, 'state')
  mkdirSync(join(root, 'home'), { recursive: true })
  mkdirSync(join(state, dirname(AUTH_STORE)), { recursive: true })
  const config = { agents: { defaults: { model: { primary: model }, workspace: join(root, 'workspace') } }, gateway: { mode: 'local', port, auth: { mode: 'token', token } } }
  writeFileSync(join(state, 'openclaw.json'), JSON.stringify(config, null, 2))
  for (const suffix of ['', '-wal', '-shm']) {
    const from = join(openclawStateDir(env), AUTH_STORE + suffix)
    if (existsSync(from)) copyFileSync(from, join(state, AUTH_STORE + suffix))
  }
}

/**
 * The agent's reply text from `openclaw agent --json` stdout, so logs and banners never reach the match.
 * `ok: false` or no payload text means a failed turn. Reads `result.payloads[].text` (then `payloads`).
 */
export function replyFromAgentJson(stdout) {
  const start = stdout.indexOf('{')
  let parsed
  try {
    parsed = JSON.parse(start < 0 ? '' : stdout.slice(start))
  } catch {
    return { text: '', failed: true, raw: stdout }
  }
  const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? []
  const text = payloads.map((p) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n')
  return { text, failed: parsed?.ok === false || text === '', raw: parsed }
}

function childOf(entry, args, root, token) {
  return spawn(process.execPath, [entry, ...args], { cwd: root, env: openclawEnv(root, token), stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Collects a child's stdout and stderr apart. */
function collect(child) {
  const out = { stdout: '', stderr: '' }
  child.stdout.on('data', (chunk) => (out.stdout += chunk))
  child.stderr.on('data', (chunk) => (out.stderr += chunk))
  return out
}

async function startGateway(entry, root, port, token) {
  const child = childOf(entry, ['gateway', '--port', String(port)], root, token)
  const out = collect(child)
  const deadline = Date.now() + 90_000
  // The gateway prints `[gateway] ready` once it serves; `spawn broker ready` earlier is not it.
  while (!/\[gateway\] ready/.test(out.stdout + out.stderr)) {
    if (child.exitCode !== null) throw new Error(`openclaw gateway exited before it was ready: ${(out.stdout + out.stderr).slice(-500)}`)
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`openclaw gateway not ready within 90 s: ${(out.stdout + out.stderr).slice(-500)}`)
    }
    await sleep(200)
  }
  return child
}

async function agentTurn(entry, root, message, token) {
  const child = childOf(entry, ['agent', '--message', message, '--agent', 'main', '--json'], root, token)
  const out = collect(child)
  const timer = setTimeout(() => child.kill('SIGKILL'), TURN_TIMEOUT_MS)
  const code = await new Promise((resolve) => child.once('close', (c) => resolve(c ?? 1)))
  clearTimeout(timer)
  const reply = replyFromAgentJson(out.stdout)
  return { ...reply, failed: reply.failed || code !== 0 }
}

/** Throws unless the copied login gives the scratch OpenClaw an `openai-chatgpt` profile. */
function requireLogin(entry, root, exec = run) {
  const out = exec(process.execPath, [entry, 'models', 'auth', 'list', '--json'], { env: openclawEnv(root), cwd: root })
  let profiles = []
  try {
    profiles = JSON.parse(String(out.stdout).slice(String(out.stdout).indexOf('{'))).profiles ?? []
  } catch {
    // an unreadable listing counts as no profile
  }
  if (!JSON.stringify(profiles).includes('openai-chatgpt')) throw new Error('the scratch OpenClaw has no openai-chatgpt login: run openclaw models auth login --provider openai-chatgpt, then retry')
}

/** One scenario turn on OpenClaw: `{ reply, version, error? }` with `reply` shaped like a transport reply. */
export async function runOpenclawTurn(scenario, { env, install = installOpenclaw }) {
  const model = env.THEOCLAW_PARITY_MODEL
  const root = mkdtempSync(join(tmpdir(), 'openclaw-parity-'))
  const token = `parity-${randomBytes(16).toString('hex')}`
  const match = new RegExp(scenario.expect.match, scenario.expect.flags)
  let gateway
  let version = OPENCLAW_VERSION
  try {
    const installed = install(root, env)
    version = installed.version
    const port = randomInt(20_000, 40_000)
    configureOpenclaw(root, env, model, token, port)
    if (install === installOpenclaw) requireLogin(installed.entry, root)
    if (scenario.surface === 'cli') {
      const transport = cliTransport({ entry: installed.entry, env: openclawEnv(root), home: root, model })
      await transport.send(scenario.send)
      return { reply: await transport.awaitReply(match, TURN_TIMEOUT_MS), version }
    }
    gateway = await startGateway(installed.entry, root, port, token)
    const reply = await agentTurn(installed.entry, root, scenario.send.message, token)
    return { reply: { ...reply, matched: match.test(reply.text) }, version }
  } catch (cause) {
    return { reply: undefined, version, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    gateway?.kill('SIGINT')
    rmSync(root, { recursive: true, force: true })
  }
}
