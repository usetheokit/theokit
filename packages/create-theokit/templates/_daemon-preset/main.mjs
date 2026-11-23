#!/usr/bin/env node
// Entry of a long-running agent app on @theokit/host.
//   node main.mjs                      run the daemon (stops cleanly on SIGINT / SIGTERM)
//   node main.mjs onboard [--yes] [--model <id>] [--force]
//   node main.mjs daemon install|uninstall|status
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { createAppHost } from '@theokit/host/app-host'
import { serviceBackend } from '@theokit/host/service'

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
  const [action] = argv
  const backend = serviceBackend()
  if (action === 'install') {
    const env = {}
    if (process.env[CONFIG_VARIABLE] !== undefined)
      env[CONFIG_VARIABLE] = process.env[CONFIG_VARIABLE]
    await backend.install({
      label: APP,
      command: process.execPath,
      args: [join(here, 'main.mjs')],
      env,
      workingDirectory: here,
    })
    console.log(`Installed service ${APP}`)
  } else if (action === 'uninstall') {
    await backend.uninstall(APP)
    console.log(`Uninstalled service ${APP}`)
  } else if (action === 'status') {
    console.log(await backend.status(APP))
  } else {
    throw new Error('usage: daemon install|uninstall|status')
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
  else if (command === 'daemon') await daemon(rest)
  else if (command === undefined || command === 'run') await run()
  else throw new Error(`unknown command "${command}" (onboard, daemon, run)`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
