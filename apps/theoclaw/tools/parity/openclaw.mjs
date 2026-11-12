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

export const OPENCLAW_VERSION = '2026.4.1'
export const SUBSCRIPTION_PREFIX = 'openai-chatgpt/'
export const OPENCLAW_SURFACES = ['control', 'cli']
const TURN_TIMEOUT_MS = 120_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The directory whose `.theokit/auth.json` holds the subscription login. */
export function authHome(env) {
  return env.THEOKIT_AUTH_HOME || env.HOME || homedir()
}

export function loginFile(env) {
  return join(authHome(env), '.theokit', 'auth.json')
}

/** What a run on the ChatGPT subscription route lacks; empty when nothing is. */
export function missingSubscription(env) {
  const missing = []
  const model = env.THEOCLAW_PARITY_MODEL
  if (!model) missing.push('THEOCLAW_PARITY_MODEL is not set')
  else if (!model.startsWith(SUBSCRIPTION_PREFIX)) missing.push(`THEOCLAW_PARITY_MODEL must be an ${SUBSCRIPTION_PREFIX}... model so both products use the subscription route`)
  if (!existsSync(loginFile(env))) missing.push(`the ChatGPT subscription login (${loginFile(env)} is missing)`)
  return missing
}

function run(command, args, options) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

/** Installs OpenClaw into `root` and returns its entry script and installed version. */
export function installOpenclaw(root, env, exec = run) {
  const out = exec('npm', ['install', '--no-audit', '--no-fund', '--prefix', root, `openclaw@${OPENCLAW_VERSION}`], { env: { PATH: env.PATH, HOME: root } })
  if (out.status !== 0) throw new Error(`npm install openclaw@${OPENCLAW_VERSION} failed: ${String(out.stderr ?? '').slice(-500)}`)
  const pkgDir = join(root, 'node_modules', 'openclaw')
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  return { entry: join(pkgDir, pkg.bin?.openclaw ?? 'openclaw.mjs'), version: pkg.version }
}

/** Writes the OpenClaw config and seeds the subscription login into the scratch home. */
export function configureOpenclaw(home, env, model, token, port) {
  const configPath = join(home, '.openclaw', 'openclaw.json')
  mkdirSync(dirname(configPath), { recursive: true })
  const config = { agents: { defaults: { model: { primary: model }, workspace: join(home, 'workspace') } }, gateway: { port, auth: { mode: 'token', token } } }
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  mkdirSync(join(home, '.theokit'), { recursive: true })
  copyFileSync(loginFile(env), join(home, '.theokit', 'auth.json'))
}

function childOf(entry, args, home, extra) {
  return spawn(process.execPath, [entry, ...args], { cwd: home, env: { PATH: process.env.PATH, HOME: home, THEOKIT_AUTH_HOME: home, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
}

async function startGateway(entry, home, port, token) {
  const child = childOf(entry, ['gateway', '--port', String(port), '--allow-unconfigured'], home, { OPENCLAW_GATEWAY_TOKEN: token })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const deadline = Date.now() + 60_000
  while (!/listening|ready/i.test(output)) {
    if (child.exitCode !== null) throw new Error(`openclaw gateway exited before listening: ${output.slice(-500)}`)
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`openclaw gateway not ready within 60 s: ${output.slice(-500)}`)
    }
    await sleep(200)
  }
  return child
}

async function agentTurn(entry, home, message, token) {
  const child = childOf(entry, ['agent', '--message', message, '--agent', 'main'], home, { OPENCLAW_GATEWAY_TOKEN: token })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const timer = setTimeout(() => child.kill('SIGKILL'), TURN_TIMEOUT_MS)
  const code = await new Promise((resolve) => child.once('close', (c) => resolve(c ?? 1)))
  clearTimeout(timer)
  return { code, output }
}

function freePort() {
  return randomInt(20_000, 40_000)
}

/** One scenario turn on OpenClaw: `{ reply, version, error? }` with `reply` shaped like a transport reply. */
export async function runOpenclawTurn(scenario, { env, install = installOpenclaw }) {
  const model = env.THEOCLAW_PARITY_MODEL
  const root = mkdtempSync(join(tmpdir(), 'openclaw-parity-'))
  const home = join(root, 'home')
  const token = `parity-${randomBytes(16).toString('hex')}`
  const match = new RegExp(scenario.expect.match, scenario.expect.flags)
  let gateway
  let version = OPENCLAW_VERSION
  try {
    const installed = install(root, env)
    version = installed.version
    configureOpenclaw(home, env, model, token, freePort())
    if (scenario.surface === 'cli') {
      const transport = cliTransport({ entry: installed.entry, env: { PATH: env.PATH, HOME: home, THEOKIT_AUTH_HOME: home }, home, model })
      await transport.send(scenario.send)
      return { reply: await transport.awaitReply(match, TURN_TIMEOUT_MS), version }
    }
    const port = JSON.parse(readFileSync(join(home, '.openclaw', 'openclaw.json'), 'utf8')).gateway.port
    gateway = await startGateway(installed.entry, home, port, token)
    const { code, output } = await agentTurn(installed.entry, home, scenario.send.message, token)
    return { reply: { text: output, matched: match.test(output), failed: code !== 0, raw: output }, version }
  } catch (cause) {
    return { reply: undefined, version, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    gateway?.kill('SIGINT')
    rmSync(root, { recursive: true, force: true })
  }
}
