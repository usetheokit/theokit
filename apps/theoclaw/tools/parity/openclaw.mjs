/**
 * Runs a scenario's turn on a pinned OpenClaw with the same model theoclaw uses (#1673).
 * Both products reach the model through the ChatGPT subscription route (`openai-chatgpt/...`), so a
 * difference is never the model's. OpenClaw is installed into a scratch directory, never the repository.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const OPENCLAW_VERSION = '2026.11.3'
export const SUBSCRIPTION_PREFIX = 'openai-chatgpt/'
const INSTALL_TIMEOUT_MS = 300_000
const READY_TIMEOUT_MS = 60_000

/** The stored ChatGPT login the SDK reads (`<home>/.theokit/auth.json`). */
export const loginPath = (home) => join(home, '.theokit', 'auth.json')

/** What is missing for a subscription-route run, as messages; empty when nothing is. */
export function missingSubscription(env = process.env, home = env.HOME ?? '') {
  const missing = []
  const model = env.THEOCLAW_PARITY_MODEL
  if (!model) missing.push('THEOCLAW_PARITY_MODEL is not set')
  else if (!model.startsWith(SUBSCRIPTION_PREFIX))
    missing.push(`THEOCLAW_PARITY_MODEL must be an ${SUBSCRIPTION_PREFIX}... model, not ${model}`)
  if (!existsSync(loginPath(home)))
    missing.push(`the ChatGPT subscription login (${loginPath(home)}) is missing: sign in first`)
  return missing
}

/** Copies the stored login into a scratch home so a product started there finds it. */
export function copyLogin(fromHome, toHome) {
  const target = loginPath(toHome)
  mkdirSync(join(toHome, '.theokit'), { recursive: true })
  copyFileSync(loginPath(fromHome), target)
}

export function openclawConfig({ model, port, token }) {
  return {
    agents: { defaults: { model: { primary: model } } },
    gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token } },
  }
}

export const agentArgs = (message, { token, port }) => [
  'agent',
  '--message',
  message,
  '--json',
  '--gateway-token',
  token,
  '--gateway-url',
  `ws://127.0.0.1:${port}`,
]

/** The reply text from `openclaw agent --json` output, or the raw output when it is not JSON. */
export function replyText(output) {
  try {
    const parsed = JSON.parse(output)
    const payloads = parsed?.result?.payloads ?? parsed?.payloads
    if (Array.isArray(payloads))
      return payloads
        .map((p) => p?.text ?? '')
        .join('\n')
        .trim()
    return String(parsed?.reply ?? parsed?.text ?? output).trim()
  } catch {
    return output.trim()
  }
}

/** The prompt OpenClaw gets, or undefined when the scenario has none for it. */
export const openclawMessage = (scenario) => scenario.openclaw?.message ?? scenario.send.message

function run(command, args, { env, cwd, timeoutMs }) {
  return spawnSync(command, args, { env, cwd, encoding: 'utf8', timeout: timeoutMs })
}

async function startGateway(bin, { env, cwd, port }) {
  const child = spawn(bin, ['gateway', '--port', String(port)], {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => (output += c))
  child.stderr.on('data', (c) => (output += c))
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    if (/listening|ready/i.test(output)) return child
    if (child.exitCode !== null)
      throw new Error(`openclaw gateway exited before it was ready: ${output.slice(-500)}`)
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(
        `openclaw gateway not ready within ${READY_TIMEOUT_MS / 1000} s: ${output.slice(-500)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * Installs OpenClaw, starts its gateway and runs one message. Resolves to
 * `{ text, matched, failed, version, raw }`. `deps` lets a test replace the install and the turn.
 */
export async function runOpenclaw(
  scenario,
  { env = process.env, port = 18789, token = 'parity-openclaw-token', deps = {} } = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-parity-'))
  const prefix = join(home, 'oc')
  const childEnv = { PATH: env.PATH, HOME: home, OPENCLAW_STATE_DIR: join(home, '.openclaw') }
  let gateway
  try {
    copyLogin(env.HOME ?? '', home)
    mkdirSync(childEnv.OPENCLAW_STATE_DIR, { recursive: true })
    writeFileSync(
      join(childEnv.OPENCLAW_STATE_DIR, 'openclaw.json'),
      JSON.stringify(openclawConfig({ model: env.THEOCLAW_PARITY_MODEL, port, token })),
    )
    if (deps.install) await deps.install(prefix)
    else {
      const installed = run(
        'npm',
        ['install', '--prefix', prefix, '--save-exact', `openclaw@${OPENCLAW_VERSION}`],
        { env: childEnv, cwd: home, timeoutMs: INSTALL_TIMEOUT_MS },
      )
      if (installed.status !== 0)
        throw new Error(
          `npm install openclaw@${OPENCLAW_VERSION} failed: ${(installed.stderr ?? '').slice(-500)}`,
        )
    }
    const version = JSON.parse(
      readFileSync(join(prefix, 'node_modules', 'openclaw', 'package.json'), 'utf8'),
    ).version
    const bin = join(prefix, 'node_modules', '.bin', 'openclaw')
    const message = openclawMessage(scenario)
    if (deps.turn) {
      const text = await deps.turn(message)
      return {
        text,
        matched: new RegExp(scenario.expect.match, scenario.expect.flags).test(text),
        failed: false,
        version,
        raw: text,
      }
    }
    gateway = await startGateway(bin, { env: childEnv, cwd: home, port })
    const out = run(bin, agentArgs(message, { token, port }), {
      env: childEnv,
      cwd: home,
      timeoutMs: 120_000,
    })
    const text = replyText(out.stdout ?? '')
    const matched = new RegExp(scenario.expect.match, scenario.expect.flags).test(text)
    return {
      text,
      matched,
      failed: out.status !== 0,
      version,
      raw: { code: out.status, stderr: (out.stderr ?? '').slice(-500) },
    }
  } finally {
    gateway?.kill('SIGINT')
    rmSync(home, { recursive: true, force: true })
  }
}
