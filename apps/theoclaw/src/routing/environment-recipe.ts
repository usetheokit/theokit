/**
 * Environment recipes for cloud workers (OC-123): the checkout on a provisioned machine is prepared
 * by exactly one recipe before the agent starts. In order: `.devcontainer/devcontainer.json`,
 * `.devcontainer.json`, `.openclaw/worktree-setup.sh` (or `.theoclaw/worktree-setup.sh`), then
 * lockfile detection. Devcontainers run the host-mode subset of the lifecycle.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type RecipeCommand = string | string[] | Record<string, string | string[]>

export interface EnvironmentRecipe {
  readonly kind: 'devcontainer' | 'setup-script' | 'lockfile'
  readonly source: string
  /** Ordered steps; each step runs its commands in parallel and finishes before the next starts. */
  readonly steps: readonly {
    readonly stage: string
    readonly commands: readonly (string | string[])[]
  }[]
}

export type RecipeExec = (command: string | string[], cwd: string) => Promise<void>

const LIFECYCLE = [
  'onCreateCommand',
  'updateContentCommand',
  'postCreateCommand',
  'postStartCommand',
] as const
const LOCKFILES: readonly (readonly [string, string[]])[] = [
  ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
  ['package-lock.json', ['npm', 'ci']],
  ['yarn.lock', ['yarn', 'install', '--frozen-lockfile']],
  ['bun.lockb', ['bun', 'install', '--frozen-lockfile']],
  ['bun.lock', ['bun', 'install', '--frozen-lockfile']],
]

/** Strip comments and trailing commas from JSONC, leaving string contents alone. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && next === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  return JSON.parse(removeTrailingCommas(out))
}

function removeTrailingCommas(json: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (inString) {
      out += c
      if (c === '\\') out += json[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === ',') {
      let j = i + 1
      while (j < json.length && /\s/.test(json[j] as string)) j++
      if (json[j] !== '}' && json[j] !== ']') out += c
    } else out += c
  }
  return out
}

function commandsOf(value: unknown): (string | string[])[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value]
  if (Array.isArray(value))
    return value.length > 0 && value.every((v) => typeof v === 'string') ? [value as string[]] : []
  if (value && typeof value === 'object') return Object.values(value).flatMap(commandsOf)
  return []
}

async function devcontainerRecipe(path: string, source: string): Promise<EnvironmentRecipe> {
  let config: Record<string, unknown>
  try {
    config = parseJsonc(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`invalid ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const steps = LIFECYCLE.map((stage) => ({ stage, commands: commandsOf(config?.[stage]) })).filter(
    (step) => step.commands.length > 0,
  )
  return { kind: 'devcontainer', source, steps }
}

/** Choose the single recipe for a checkout, or `undefined` when it has none. */
export async function detectRecipe(root: string): Promise<EnvironmentRecipe | undefined> {
  for (const source of ['.devcontainer/devcontainer.json', '.devcontainer.json']) {
    if (existsSync(join(root, source))) return devcontainerRecipe(join(root, source), source)
  }
  for (const source of ['.openclaw/worktree-setup.sh', '.theoclaw/worktree-setup.sh']) {
    if (existsSync(join(root, source))) {
      return {
        kind: 'setup-script',
        source,
        steps: [{ stage: 'setup', commands: [['sh', source]] }],
      }
    }
  }
  const lock = LOCKFILES.find(([file]) => existsSync(join(root, file)))
  if (lock && !existsSync(join(root, 'node_modules'))) {
    return { kind: 'lockfile', source: lock[0], steps: [{ stage: 'install', commands: [lock[1]] }] }
  }
  return undefined
}

/** Run a command with the checkout as its working directory; a string goes through a shell. */
export const execRecipeCommand: RecipeExec = (command, cwd) =>
  new Promise((resolve, reject) => {
    const [file, args] =
      typeof command === 'string'
        ? ['sh', ['-c', command]]
        : [command[0] as string, command.slice(1)]
    execFile(
      file,
      args,
      { cwd, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      (error, _out, stderr) => {
        if (error) reject(new Error(`${String(stderr).trim() || error.message}`))
        else resolve()
      },
    )
  })

export async function runRecipe(
  recipe: EnvironmentRecipe,
  cwd: string,
  exec: RecipeExec = execRecipeCommand,
) {
  for (const step of recipe.steps) {
    try {
      await Promise.all(step.commands.map((command) => exec(command, cwd)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`environment recipe ${recipe.source}: ${step.stage} failed: ${detail}`)
    }
  }
}
