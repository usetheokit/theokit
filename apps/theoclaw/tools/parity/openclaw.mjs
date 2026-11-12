/**
 * Runs a scenario's turn on a pinned OpenClaw with the same model theoclaw uses (#1673).
 * Both products reach the model through the ChatGPT subscription (theoclaw as `openai-chatgpt/<name>`,
 * OpenClaw as its `openai/<name>` ref, which it serves from the Codex ChatGPT login), so a difference
 * is never the model's. OpenClaw is installed into a scratch directory, never the repository.
 * Facts below come from the pinned release's own docs (`docs/cli/agent.md`, `docs/help/environment.md`).
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const OPENCLAW_VERSION = '2026.11.3'
export const SUBSCRIPTION_PREFIX = 'openai-chatgpt/'
const INSTALL_TIMEOUT_MS = 300_000
const READY_TIMEOUT_MS = 60_000
const TURN_TIMEOUT_S = 120

/** theoclaw reads the SDK's stored ChatGPT login; OpenClaw reads the Codex CLI's (`$CODEX_HOME` or `~/.codex`). */
export const loginPath = (home) => join(home, '.theokit', 'auth.json')
export const codexLoginPath = (home) => join(home, '.codex', 'auth.json')

/** OpenClaw 2026.11 needs Node 24.16+ or 26.1+ (it refuses older runtimes). */
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  return (major === 24 && minor >= 16) || (major === 26 && minor >= 1) || major > 26
}

/** What is missing for a subscription-route run, as messages; empty when nothing is. */
export function missingSubscription(env = process.env, home = env.HOME ?? '', node = process.versions.node) {
  const missing = []
  const model = env.THEOCLAW_PARITY_MODEL
  if (!model) missing.push('THEOCLAW_PARITY_MODEL is not set')
  else if (!model.startsWith(SUBSCRIPTION_PREFIX)) missing.push(`THEOCLAW_PARITY_MODEL must be an ${SUBSCRIPTION_PREFIX}... model, not ${model}`)
  if (!existsSync(loginPath(home))) missing.push(`the ChatGPT subscription login for theoclaw (${loginPath(home)}) is missing: sign in first`)
  if (!existsSync(codexLoginPath(home))) missing.push(`the ChatGPT login for OpenClaw (${codexLoginPath(home)}, the Codex CLI login) is missing`)
  if (!nodeSupported(node)) missing.push(`OpenClaw ${OPENCLAW_VERSION} needs Node 24.16+ or 26.1+, this is ${node}`)
  return missing
}

function copyFileInto(source, target) {
  if (!existsSync(source)) return
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}

/** Copies the stored theoclaw login into a scratch home so a product started there finds it. A missing login is left to the preflight. */
export function copyLogin(fromHome, toHome) {
  copyFileInto(loginPath(fromHome), loginPath(toHome))
}

/** OpenClaw's ref for the same subscription model: `openai-chatgpt/<name>` is `openai/<name>`. */
export const openclawModelRef = (model) => (model.startsWith(SUBSCRIPTION_PREFIX) ? `openai/${model.slice(SUBSCRIPTION_PREFIX.length)}` : model)

export function openclawConfig({ model, port }) {
  return { agents: { defaults: { model: { primary: openclawModelRef(model) } } }, gateway: { mode: 'local', port, bind: 'loopback' } }
}

/** The token travels in `OPENCLAW_GATEWAY_TOKEN` and the port in `OPENCLAW_GATEWAY_PORT`, not on a command line. */
export const agentArgs = (message) => ['agent', '--agent', 'main', '--message', message, '--json', '--timeout', String(TURN_TIMEOUT_S)]

/** The reply text from `openclaw agent --json` output (`final`, else `payloads`), or the raw output when it is not JSON. */
export function replyText(output) {
  try {
    const parsed = JSON.parse(output)
    if (typeof parsed?.final === 'string') return parsed.final.trim()
    if (Array.isArray(parsed?.payloads)) return parsed.payloads.map((p) => p?.text ?? '').join('\n').trim()
    return String(parsed?.error?.message ?? '').trim()
  } catch {
    return output.trim()
  }
}

/** The prompt OpenClaw gets, or undefined when the scenario has none for it. */
export const openclawMessage = (scenario) => scenario.openclaw?.message ?? scenario.send.message

function run(command, args, { env, cwd, timeoutMs }) {
  return spawnSync(command, args, { env, cwd, encoding: 'utf8', timeout: timeoutMs })
}

const accepts = (port) =>
  new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

async function startGateway(bin, { env, cwd, port }) {
  const child = spawn(bin, ['gateway', 'run', '--port', String(port)], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (c) => (output += c))
  child.stderr.on('data', (c) => (output += c))
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    if (await accepts(port)) return child
    if (child.exitCode !== null) throw new Error(`openclaw gateway exited before it was ready: ${output.slice(-500)}`)
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`openclaw gateway not ready within ${READY_TIMEOUT_MS / 1000} s: ${output.slice(-500)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

function install(prefix, childEnv, home) {
  const done = run('npm', ['install', '--prefix', prefix, '--save-exact', `openclaw@${OPENCLAW_VERSION}`], { env: childEnv, cwd: home, timeoutMs: INSTALL_TIMEOUT_MS })
  if (done.status !== 0) throw new Error(`npm install openclaw@${OPENCLAW_VERSION} failed: ${(done.stderr ?? '').slice(-500)}`)
}

/**
 * Installs OpenClaw, starts its gateway and runs one message. Resolves to
 * `{ text, matched, failed, version, raw }`. `deps` lets a test replace the install and the turn.
 */
export async function runOpenclaw(scenario, { env = process.env, port = 18789, deps = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-parity-'))
  const prefix = join(home, 'oc')
  const token = randomBytes(24).toString('hex')
  const childEnv = { PATH: env.PATH, HOME: home, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_GATEWAY_PORT: String(port) }
  let gateway
  try {
    copyFileInto(codexLoginPath(env.HOME ?? ''), codexLoginPath(home))
    mkdirSync(join(home, '.openclaw'), { recursive: true })
    writeFileSync(join(home, '.openclaw', 'openclaw.json'), JSON.stringify(openclawConfig({ model: env.THEOCLAW_PARITY_MODEL, port })))
    if (deps.install) await deps.install(prefix)
    else install(prefix, childEnv, home)
    const version = JSON.parse(readFileSync(join(prefix, 'node_modules', 'openclaw', 'package.json'), 'utf8')).version
    const bin = join(prefix, 'node_modules', '.bin', 'openclaw')
    const message = openclawMessage(scenario)
    let text
    let failed = false
    let raw
    if (deps.turn) text = await deps.turn(message)
    else {
      gateway = await startGateway(bin, { env: childEnv, cwd: home, port })
      const out = run(bin, agentArgs(message), { env: childEnv, cwd: home, timeoutMs: (TURN_TIMEOUT_S + 30) * 1000 })
      text = replyText(out.stdout ?? '')
      failed = out.status !== 0
      raw = { code: out.status, stderr: (out.stderr ?? '').slice(-500) }
    }
    const matched = new RegExp(scenario.expect.match, scenario.expect.flags).test(text)
    return { text, matched, failed, version, raw }
  } finally {
    gateway?.kill('SIGINT')
    rmSync(home, { recursive: true, force: true })
  }
}
