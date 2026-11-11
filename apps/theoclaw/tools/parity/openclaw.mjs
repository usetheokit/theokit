/**
 * The OpenClaw side of the parity harness (#1673): installs a pinned OpenClaw release into a scratch
 * directory, points it at the same `openai-chatgpt/...` model theoclaw uses, starts its gateway and
 * runs the scenario's turn (`openclaw agent --message` for /control, scripted commands for the CLI).
 * Every process and the install go through `deps`, so tests can stub them.
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { dirname, join } from 'node:path'

/** The OpenClaw release every parity run installs. Bump it on purpose, never with "latest". */
export const OPENCLAW_VERSION = '2026.11.3'
export const SUBSCRIPTION_PREFIX = 'openai-chatgpt/'
const GATEWAY_TIMEOUT_MS = 60_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Where the stored ChatGPT subscription logins live, theoclaw's (the SDK store) and OpenClaw's. */
export function loginPaths(env) {
  const home = env.HOME ?? ''
  return {
    theoclaw: env.THEOCLAW_PARITY_THEOKIT_AUTH ?? join(home, '.theokit', 'auth.json'),
    openclaw:
      env.THEOCLAW_PARITY_OPENCLAW_AUTH ??
      join(home, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json'),
  }
}

/** What is missing for a run that needs OpenClaw, as readable lines; empty when nothing is. */
export function missingForOpenClaw(side, env, exists = existsSync) {
  const missing = []
  if (!env.THEOCLAW_PARITY_MODEL) missing.push('THEOCLAW_PARITY_MODEL is not set')
  else if (!env.THEOCLAW_PARITY_MODEL.startsWith(SUBSCRIPTION_PREFIX))
    missing.push(
      `THEOCLAW_PARITY_MODEL must be an ${SUBSCRIPTION_PREFIX}... model (the ChatGPT subscription route), got ${env.THEOCLAW_PARITY_MODEL}`,
    )
  const paths = loginPaths(env)
  if (side === 'both' && !exists(paths.theoclaw))
    missing.push(`no ChatGPT subscription login for theoclaw (${paths.theoclaw} is missing)`)
  if (!exists(paths.openclaw))
    missing.push(`no ChatGPT subscription login for OpenClaw (${paths.openclaw} is missing)`)
  return missing
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function runProcess(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output })
    })
    child.once('error', (cause) => {
      clearTimeout(timer)
      resolve({ code: 1, output: String(cause) })
    })
  })
}

/** The real side effects. `install` returns the path of the `openclaw` binary. */
export const realDeps = {
  freePort,
  async install(dir, version) {
    const out = spawnSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- npm is resolved from PATH on dev machines and CI; no fixed install path exists
      'npm',
      ['install', '--prefix', dir, '--no-audit', '--no-fund', `openclaw@${version}`],
      { encoding: 'utf8' },
    )
    if (out.status !== 0)
      throw new Error(`npm install openclaw@${version} failed: ${String(out.stderr).slice(-500)}`)
    return join(dir, 'node_modules', '.bin', 'openclaw')
  },
  run: runProcess,
  startGateway(bin, args, { cwd, env }) {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    return {
      output: () => output,
      exited: () => child.exitCode !== null,
      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return
        const gone = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGINT')
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
        await gone
        clearTimeout(timer)
      },
    }
  },
  waitForPort: async (port, gateway) => {
    const deadline = Date.now() + GATEWAY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await canConnect(port)) return
      if (gateway.exited())
        throw new Error(`openclaw gateway exited before listening: ${gateway.output().slice(-500)}`)
      await sleep(200)
    }
    throw new Error(
      `openclaw gateway not listening within ${GATEWAY_TIMEOUT_MS / 1000} s: ${gateway.output().slice(-500)}`,
    )
  },
}

/** The OpenClaw config for the scratch run: the shared model, a loopback gateway with a token. */
export function openclawConfig({ model, port, token }) {
  return {
    agents: { defaults: { model: { primary: model } } },
    gateway: { port, bind: 'loopback', auth: { mode: 'token', token } },
  }
}

/**
 * Runs one scenario on OpenClaw in `home` (a scratch directory the caller owns and removes).
 * Resolves with `{ version, text, failed, skipped?, error? }`; never rejects for a product failure.
 */
export async function runOpenClaw(
  scenario,
  { env, home, model, token, turnTimeoutMs = 60_000, deps = realDeps, version = OPENCLAW_VERSION },
) {
  if (scenario.surface !== 'control' && scenario.surface !== 'cli')
    return {
      version,
      text: '',
      failed: false,
      skipped: `OpenClaw has no ${scenario.surface} equivalent in the harness`,
    }
  let gateway
  try {
    const bin = await deps.install(join(home, 'openclaw-install'), version)
    const state = join(home, '.openclaw')
    mkdirSync(join(state, 'agents', 'main', 'agent'), { recursive: true })
    copyFileSync(
      loginPaths(env).openclaw,
      join(state, 'agents', 'main', 'agent', 'auth-profiles.json'),
    )
    const port = await deps.freePort()
    const configPath = join(state, 'openclaw.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify(openclawConfig({ model, port, token })), {
      mode: 0o600,
    })
    const childEnv = {
      PATH: env.PATH,
      HOME: home,
      OPENCLAW_STATE_DIR: state,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_TOKEN: token,
    }
    gateway = deps.startGateway(bin, ['gateway', '--port', String(port)], {
      cwd: home,
      env: childEnv,
    })
    await deps.waitForPort(port, gateway)
    const commands =
      scenario.surface === 'control'
        ? [['agent', '--message', scenario.send.message]]
        : (scenario.send.openclawCommands ?? [])
    if (commands.length === 0)
      return {
        version,
        text: '',
        failed: false,
        skipped: 'the scenario names no OpenClaw commands',
      }
    let last
    let failed = false
    for (const command of commands) {
      last = await deps.run(bin, command, { cwd: home, env: childEnv, timeoutMs: turnTimeoutMs })
      if (last.code !== 0) {
        failed = true
        break
      }
    }
    return { version, text: last?.output ?? '', failed }
  } catch (cause) {
    return {
      version,
      text: '',
      failed: true,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  } finally {
    await gateway?.stop()
  }
}
