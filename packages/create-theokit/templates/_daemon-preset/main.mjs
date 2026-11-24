#!/usr/bin/env node
// Entry of a long-running agent app on @theokit/host.
//   node main.mjs                      run the daemon (stops cleanly on SIGINT / SIGTERM)
//   node main.mjs onboard [--yes] [--model <id>] [--force]
//   node main.mjs daemon install|uninstall|status|restart|logs
//   node main.mjs --config <path> [--profile <name>]   how a Windows scheduled task starts the daemon
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { createAppHost } from '@theokit/host/app-host'
import { daemonCommands, serviceBackend } from '@theokit/host/service'

import {
  APP,
  CONFIG_VARIABLE,
  DEFAULT_MODEL,
  MODEL_KEY,
  STATE_DIR_VARIABLE,
  config,
} from './app.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const home = homedir()

// DATA_DIR (set by the Dockerfile) puts the config file and the state under one volume.
const { DATA_DIR: dataDir } = process.env
if (dataDir !== undefined && dataDir !== '') {
  process.env[CONFIG_VARIABLE] ??= join(dataDir, 'config', `${APP}.env`)
  process.env[STATE_DIR_VARIABLE] ??= join(dataDir, 'state')
}

function stateDir(env) {
  const explicit = env[STATE_DIR_VARIABLE]
  return explicit !== undefined && explicit !== '' ? explicit : join(home, '.local', 'state', APP)
}

async function onboard(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      yes: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string' },
    },
  })
  const answers =
    values.yes || values.model !== undefined ? { [MODEL_KEY]: values.model ?? DEFAULT_MODEL } : {}
  const { path } = await config.onboard(
    { stdin: process.stdin, stdout: process.stdout, env: process.env, homeDir: home },
    {
      interactive: !values.yes,
      force: values.force,
      answers,
      prompts: { [MODEL_KEY]: { question: 'Model', default: DEFAULT_MODEL } },
    },
  )
  console.log(`Wrote ${path}`)
}

async function daemon(argv) {
  const [action, ...rest] = argv
  const backend = serviceBackend()
  const commands = daemonCommands(backend, {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    prefix: APP,
  })
  switch (action) {
    case 'install':
      // A scheduled task carries no environment: on Windows the config goes in as `--config <path>`.
      return commands.install({
        label: APP,
        command: process.execPath,
        args: [join(here, 'main.mjs')],
        env:
          process.env[CONFIG_VARIABLE] === undefined
            ? {}
            : { [CONFIG_VARIABLE]: process.env[CONFIG_VARIABLE] },
        entryArgs: () => config.entryArgs(process.env, home),
        workingDirectory: here,
      })
    case 'uninstall':
      return commands.uninstall(APP)
    case 'status':
      return commands.status(APP)
    case 'restart':
      return commands.restart(APP)
    case 'logs': {
      const { values } = parseArgs({
        args: rest,
        options: { lines: { type: 'string', default: '200' } },
      })
      return commands.logs(APP, Number(values.lines))
    }
    default:
      throw new Error('usage: daemon install|uninstall|status|restart|logs [--lines <n>]')
  }
}

async function run() {
  const path = config.load(process.env, home)
  const dir = stateDir(process.env)
  const host = createAppHost({
    signals: process,
    exit: (code) => process.exit(code),
    onError: (step, error) => console.error(`stop of ${step} failed:`, error),
  })

  // Replace this placeholder with your agent workload. A daemon needs a live resource (a timer,
  // a server, a connection); the unref-free interval keeps the process alive until the host stops it.
  host.service(
    'agent',
    () => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'started.json'),
        JSON.stringify({ pid: process.pid, config: path ?? null }) + '\n',
      )
      return setInterval(() => {}, 60_000)
    },
    (timer) => {
      clearInterval(timer)
    },
  )

  await host.start()
  console.log(`${APP} started (state: ${dir}, config: ${path ?? 'none'})`)
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'onboard') await onboard(rest)
  else if (command === 'daemon') process.exitCode = await daemon(rest)
  else if (command === '--config' || command === '--profile') {
    config.applyEntryArgs(process.argv.slice(2), process.env)
    await run()
  } else if (command === undefined || command === 'run') await run()
  else throw new Error(`unknown command "${command}" (onboard, daemon, run)`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
