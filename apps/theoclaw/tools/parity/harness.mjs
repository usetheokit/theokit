/**
 * Runs one scripted turn per OC id against the built theoclaw (`dist/`) and writes
 * `parity/results/<id>.json` (#1591). The model is `THEOCLAW_PARITY_MODEL`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chatBotEnv, chatSecrets, chatSetup, missingChatVariables } from './chat-platforms.mjs'
import { OPENCLAW_SURFACES, SUBSCRIPTION_PREFIX, authHome, loginFile, missingSubscription, runOpenclawTurn } from './openclaw.mjs'
import { SCENARIOS } from './scenarios.mjs'
import { cliTransport, controlTransport, webchatTransport } from './transport.mjs'

export const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
export const RESULTS_DIR = join(APP_DIR, 'parity', 'results')
const TURN_TIMEOUT_MS = 60_000
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i

/** Every configured secret value in `env` plus `extra`, long enough that masking it cannot eat prose. */
export function secretValues(env, extra = []) {
  const values = Object.entries(env).filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= 8).map(([, value]) => value)
  return [...values, ...extra].filter((value) => value.length >= 8)
}

/** Replaces every secret value anywhere in a JSON-able value. */
export function redact(value, secrets) {
  let text = JSON.stringify(value) ?? 'null'
  for (const secret of secrets) text = text.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]').split(secret).join('[redacted]')
  return JSON.parse(text)
}

export function verdictFor(scenario, reply) {
  if (reply.failed || reply.text.trim() === '') return 'broken'
  return reply.matched ? 'works' : 'partial'
}

function git(args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is resolved from PATH on dev machines and CI; no fixed install path exists
  const out = spawnSync('git', args, { cwd: APP_DIR, encoding: 'utf8' })
  return out.status === 0 ? out.stdout.trim() : 'unknown'
}

function versions() {
  const own = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'))
  const dep = (name) => own.dependencies[name]
  return { theoclaw: own.version, '@theokit/sdk': dep('@theokit/sdk'), '@theokit/gateway': dep('@theokit/gateway'), '@theokit/agents': dep('@theokit/agents'), node: process.version }
}

async function startProcess(home, env) {
  const entry = join(APP_DIR, 'dist', 'main.js')
  if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm --filter theoclaw run build`)
  const child = spawn(process.execPath, [entry], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const deadline = Date.now() + 20_000
  for (;;) {
    const match = output.match(/theoclaw: control plane listening on 127\.0\.0\.1:(\d+)/)
    if (match) return { child, port: Number(match[1]), output: () => output }
    if (child.exitCode !== null) throw new Error(`theoclaw exited before listening: ${output.slice(-500)}`)
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`no listening line within 20 s: ${output.slice(-500)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGINT')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await gone
  clearTimeout(timer)
}

/** Starts what the scenario's surface needs and returns its transport (and the process, to stop later). */
async function buildTransport(scenario, { env, home, childEnv, token, makeTransport }) {
  if (makeTransport) return { transport: makeTransport(scenario, { home, childEnv, token }) }
  if (scenario.surface === 'cli')
    return {
      transport: cliTransport({
        entry: join(APP_DIR, 'dist', 'cli.js'),
        env: childEnv,
        home,
        model: childEnv.THEOCLAW_MODEL,
      }),
    }
  if (scenario.surface === 'matrix' || scenario.surface === 'mattermost') {
    // The human's id is known after the DM exists, and the bot must list it as an owner before it starts.
    const setup = await chatSetup(scenario.surface, env)
    childEnv.THEOCLAW_OWNERS = setup.owner
    return { running: await startProcess(home, childEnv), transport: setup.transport }
  }
  const running = await startProcess(home, childEnv)
  const transport =
    scenario.surface === 'control'
      ? controlTransport({ port: running.port, token })
      : webchatTransport({ base: `http://127.0.0.1:${running.port}`, token })
  return { running, transport }
}

export const SIDES = ['theoclaw', 'openclaw', 'both']

function theoclawEnv(env, { model, key, token, home }) {
  return {
    PATH: env.PATH,
    HOME: home,
    THEOCLAW_MODEL: model,
    ...(env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: env.THEOKIT_API_KEY } : {}),
    ...(env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY } : {}),
    ...(model.startsWith(SUBSCRIPTION_PREFIX) ? { THEOKIT_AUTH_HOME: authHome(env) } : {}),
    THEOCLAW_PARITY_KEY: key ?? '',
    THEOCLAW_PORT: '0',
    THEOCLAW_CONTROL_TOKEN: token,
    THEOCLAW_WEBCHAT_TOKEN: token,
    THEOCLAW_OWNERS: 'telegram:owner',
    THEOCLAW_DM_POLICY: 'allowlist',
    THEOCLAW_WORKSPACE: home,
  }
}

/** Runs the turn on a built theoclaw: `{ reply, error?, secrets }`. */
async function runTheoclawTurn(scenario, { env, model, makeTransport }) {
  const key = env.THEOKIT_API_KEY ?? env.OPENROUTER_API_KEY
  const token = `parity-${randomBytes(16).toString('hex')}`
  const home = mkdtempSync(join(tmpdir(), 'theoclaw-parity-'))
  const childEnv = theoclawEnv(env, { model, key, token, home })
  const chat = scenario.surface === 'matrix' || scenario.surface === 'mattermost'
  if (chat) Object.assign(childEnv, chatBotEnv(scenario.surface, env))
  const secrets = secretValues({ ...env, ...childEnv }, [token, ...chatSecrets(env)])
  let running
  try {
    const built = await buildTransport(scenario, { env, home, childEnv, token, makeTransport })
    running = built.running
    await built.transport.send(scenario.send)
    const reply = await built.transport.awaitReply(new RegExp(scenario.expect.match, scenario.expect.flags), TURN_TIMEOUT_MS)
    return { reply, secrets }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause), secrets }
  } finally {
    if (running) await stop(running.child)
    rmSync(home, { recursive: true, force: true })
  }
}

/** The per-product block of a result file. */
function sideBlock(scenario, { reply, error, version }, model) {
  return {
    verdict: reply === undefined ? 'broken' : verdictFor(scenario, reply),
    reply: reply?.text ?? '',
    ...(error === undefined ? {} : { error }),
    version,
    model,
  }
}

function readPrevious(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Runs a scenario on `side` (`theoclaw`, `openclaw` or `both`) and writes `results/<id>.json`. The
 * top-level fields stay theoclaw's (the gate reads them); `theoclaw` and `openclaw` hold each side.
 * `makeTransport` overrides the real theoclaw surface and `openclawTurn` the OpenClaw runner (tests).
 */
export async function runScenario(scenario, { env = process.env, side = 'theoclaw', makeTransport, openclawTurn = runOpenclawTurn, resultsDir = RESULTS_DIR, now = () => new Date() } = {}) {
  const model = env.THEOCLAW_PARITY_MODEL
  if (!model) throw new Error('THEOCLAW_PARITY_MODEL is not set')
  const path = join(resultsDir, `${scenario.id}.json`)
  const previous = readPrevious(path)
  let secrets = secretValues(env)
  const blocks = {}
  const base = { id: scenario.id, surface: scenario.surface, sent: scenario.send, model, date: now().toISOString() }
  if (side !== 'openclaw') {
    const turn = await runTheoclawTurn(scenario, { env, model, makeTransport })
    secrets = [...secrets, ...turn.secrets]
    const block = sideBlock(scenario, { ...turn, version: versions().theoclaw }, model)
    Object.assign(base, { verdict: block.verdict, reply: block.reply, ...(block.error === undefined ? {} : { error: block.error }), commit: git(['rev-parse', 'HEAD']), versions: versions() })
    blocks.theoclaw = block
  }
  if (side !== 'theoclaw') blocks.openclaw = sideBlock(scenario, await openclawTurn(scenario, { env }), model)
  const merged = side === 'both' ? { ...base, ...blocks } : { ...previous, ...base, ...blocks }
  const result = redact(merged, secrets)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  return result
}

function hasCredential(env) {
  if (env.THEOKIT_API_KEY ?? env.OPENROUTER_API_KEY) return true
  return env.THEOCLAW_PARITY_MODEL.startsWith(SUBSCRIPTION_PREFIX) && existsSync(loginFile(env))
}

/** Why a scenario cannot run here, or undefined when it can. */
export function skipReason(scenario, env = process.env, side = 'theoclaw') {
  if (!env.THEOCLAW_PARITY_MODEL) return 'THEOCLAW_PARITY_MODEL is not set'
  if (side === 'openclaw' && !OPENCLAW_SURFACES.includes(scenario.surface)) return `OpenClaw has no runner for the ${scenario.surface} surface`
  if (side !== 'openclaw') {
    if (!hasCredential(env)) return 'no model credential (THEOKIT_API_KEY, OPENROUTER_API_KEY or the ChatGPT subscription login)'
    const missingChat = missingChatVariables(scenario.surface, env)
    if (missingChat.length > 0) return `missing ${missingChat.join(', ')}`
    if (!['control', 'webchat', 'cli', 'matrix', 'mattermost'].includes(scenario.surface)) return `no transport for the ${scenario.surface} surface`
  }
  return undefined
}

/** The `--side` value, or undefined when it is not one of SIDES. */
function sideOf(args) {
  const at = args.indexOf('--side')
  if (at < 0) return 'theoclaw'
  return SIDES.includes(args[at + 1]) ? args[at + 1] : undefined
}

export async function runCli(argv, { out = console, env = process.env, scenarios = SCENARIOS, run = runScenario } = {}) {
  const args = argv.filter((arg) => arg !== '--')
  const idAt = args.indexOf('--id')
  const all = args.includes('--all')
  const side = sideOf(args)
  if (all === (idAt >= 0) || side === undefined) {
    out.error('usage: parity --id <OC id> | --all [--side openclaw|theoclaw|both]')
    return 2
  }
  const picked = all ? scenarios : scenarios.filter((s) => s.id === args[idAt + 1])
  if (picked.length === 0) {
    out.error(`no scenario for ${args[idAt + 1]}`)
    return 2
  }
  // Before either product starts: OpenClaw runs only on the subscription route.
  const missing = side === 'theoclaw' ? [] : missingSubscription(env)
  if (missing.length > 0) {
    out.error(`parity --side ${side} cannot run, missing: ${missing.join('; ')}`)
    return 2
  }
  let code = 0
  for (const scenario of picked) code = Math.max(code, await runPicked(scenario, { env, side, all, run, out }))
  return code
}

/** Runs one picked scenario and returns its exit code. */
async function runPicked(scenario, { env, side, all, run, out }) {
  const reason = skipReason(scenario, env, side)
  if (reason !== undefined) {
    out.log(`skip ${scenario.id}: ${reason}`)
    return all ? 0 : 2
  }
  const runSide = side === 'both' && !OPENCLAW_SURFACES.includes(scenario.surface) ? 'theoclaw' : side
  const result = await run(scenario, { env, side: runSide })
  out.log(`${scenario.id} (${scenario.surface}): ${summary(result, runSide)}`)
  return verdictsOf(result, runSide).some((v) => v !== 'works') ? 1 : 0
}

const sidesOf = (side) => (side === 'both' ? ['theoclaw', 'openclaw'] : [side])
const verdictsOf = (result, side) => sidesOf(side).map((name) => result[name]?.verdict ?? result.verdict)
const summary = (result, side) => (side === 'theoclaw' ? result.verdict : sidesOf(side).map((name) => `${name} ${result[name]?.verdict}`).join(', '))
