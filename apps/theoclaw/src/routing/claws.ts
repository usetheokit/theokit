import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import type { AgentProfile, AgentRoute } from './agent-routes.js'

/**
 * `theoclaw claws add|update|remove|list` (OC-136): a packaged agent is a directory holding a
 * `claw.json` manifest ({ id?, routes?: ["slack", "matrix:@peer"], tools?: [...] }) and the agent's
 * workspace files (persona files such as SOUL.md, `skills/`). `add` copies it to
 * `<THEOCLAW_STATE_DIR>/claws/<id>/workspace`; the router reads the installed claws at start, so
 * the agent answers the platforms and peers its manifest binds, with the package's persona.
 */

export interface ClawsIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly stdout: Writable
  readonly stderr: Writable
}

export interface Claw {
  readonly id: string
  readonly routes: readonly string[]
  readonly tools: readonly string[]
  readonly workspace: string
}

const MANIFEST = 'claw.json'
const ID = /^\w+$/

export function clawsDir(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const state = env.THEOCLAW_STATE_DIR?.trim()
  return state === undefined || state === '' ? undefined : join(state, 'claws')
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new UsageError(`theoclaw claws: ${MANIFEST} "${field}" must be a list of non-empty strings`)
  }
  return (value as string[]).map((entry) => entry.trim())
}

function readManifest(file: string, fallbackId: string): { id: string; routes: string[]; tools: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new UsageError(`theoclaw claws: ${file} is missing or not valid JSON`)
  }
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : fallbackId
  if (!ID.test(id) || id === 'main') throw new UsageError('theoclaw claws: the agent id must be word characters and not "main"')
  return { id, routes: strings(record.routes, 'routes'), tools: strings(record.tools, 'tools') }
}

/** The installed claws; an unreadable one is skipped. */
export function listClaws(env: Readonly<Record<string, string | undefined>>): Claw[] {
  const dir = clawsDir(env)
  if (dir === undefined || !existsSync(dir)) return []
  const claws: Claw[] = []
  for (const name of readdirSync(dir).sort()) {
    try {
      const manifest = readManifest(join(dir, name, MANIFEST), name)
      claws.push({ ...manifest, id: name, workspace: join(dir, name, 'workspace') })
    } catch {
      continue
    }
  }
  return claws
}

/** The router's view of the installed claws: profiles and the routes their manifests bind. */
export function clawRouting(env: Readonly<Record<string, string | undefined>>): { agents: AgentProfile[]; routes: AgentRoute[] } {
  const agents: AgentProfile[] = []
  const routes: AgentRoute[] = []
  for (const claw of listClaws(env)) {
    agents.push({ id: claw.id, workspace: claw.workspace })
    for (const target of claw.routes) {
      const colon = target.indexOf(':')
      const platform = colon < 0 ? target : target.slice(0, colon)
      const peer = colon < 0 ? '' : target.slice(colon + 1)
      if (platform === '' || (colon >= 0 && peer === '')) {
        throw new TheoClawConfigError(`claw ${claw.id}: route "${target}" must be <platform>[:<peer>]`, { variable: 'THEOCLAW_STATE_DIR' })
      }
      routes.push({ agent: claw.id, platform, ...(peer === '' ? {} : { peer }) })
    }
  }
  return { agents, routes }
}

function install(source: string, dir: string, mustExist: boolean, io: ClawsIo): string {
  const from = resolve(io.cwd, source)
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new UsageError(`theoclaw claws: ${from} is not a directory`)
  const manifest = readManifest(join(from, MANIFEST), basename(from))
  const target = join(dir, manifest.id)
  if (mustExist && !existsSync(target)) throw new UsageError(`theoclaw claws: no agent ${manifest.id} is installed; use add`)
  if (!mustExist && existsSync(target)) throw new UsageError(`theoclaw claws: agent ${manifest.id} is already installed; use update`)
  mkdirSync(dir, { recursive: true })
  // Stage first, so a failed copy leaves an installed agent intact.
  const staging = join(dir, `.${manifest.id}.staging`)
  rmSync(staging, { recursive: true, force: true })
  cpSync(from, join(staging, 'workspace'), { recursive: true, filter: (path) => basename(path) !== MANIFEST })
  writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(target, { recursive: true, force: true })
  cpSync(staging, target, { recursive: true })
  rmSync(staging, { recursive: true, force: true })
  return manifest.id
}

export async function clawsCommand(args: readonly string[], io: ClawsIo): Promise<number> {
  const [action, value, ...rest] = args
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const dir = clawsDir(env)
  if (dir === undefined || !isAbsolute(dir)) throw new UsageError('theoclaw claws: THEOCLAW_STATE_DIR is not set; run theoclaw onboard first')
  if (action === 'list' && value === undefined) {
    for (const claw of listClaws(env)) io.stdout.write(`${claw.id}${claw.routes.length === 0 ? '' : ` -> ${claw.routes.join(', ')}`}\n`)
    return 0
  }
  if (value === undefined || rest.length > 0 || (action !== 'add' && action !== 'update' && action !== 'remove')) {
    throw new UsageError('theoclaw claws: expected add <dir> | update <dir> | remove <id> | list')
  }
  if (action === 'remove') {
    if (!ID.test(value) || !existsSync(join(dir, value))) throw new UsageError(`theoclaw claws: no agent ${value} is installed`)
    rmSync(join(dir, value), { recursive: true, force: true })
    io.stdout.write(`Removed agent: ${value}\n`)
    return 0
  }
  const id = install(value, dir, action === 'update', io)
  io.stdout.write(`${action === 'add' ? 'Added' : 'Updated'} agent: ${id}\nRestart theoclaw for the change to take effect.\n`)
  return 0
}
