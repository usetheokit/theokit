/**
 * Environment recipes for cloud tasks (OC-123): one recipe is picked from the checked-out commit
 * and its setup runs on the host, in the checkout, before the agent starts.
 *
 * Order of choice: `.devcontainer/devcontainer.json`, `.devcontainer.json`,
 * `.openclaw/worktree-setup.sh`, then lockfile detection. For a devcontainer the host-mode subset
 * of the lifecycle runs: onCreateCommand, updateContentCommand, postCreateCommand, postStartCommand.
 */
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type RecipeKind = 'devcontainer' | 'setup-script' | 'lockfile'

export interface RecipeStep {
  readonly stage: string
  readonly argv: readonly string[]
}

export interface EnvironmentRecipe {
  readonly kind: RecipeKind
  /** The file (or lockfile) the recipe came from, relative to the checkout. */
  readonly source: string
  readonly steps: readonly RecipeStep[]
}

export const LIFECYCLE = ['onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand'] as const

const LOCKFILES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
  ['package-lock.json', ['npm', 'ci']],
  ['yarn.lock', ['yarn', 'install', '--frozen-lockfile']],
  ['bun.lockb', ['bun', 'install']],
  ['bun.lock', ['bun', 'install']],
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Strip // and block comments and trailing commas outside strings (devcontainer.json is JSONC). */
export function parseJsonc(text: string): unknown {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return JSON.parse(stripTrailingCommas(out))
}

/** Drop commas that directly precede `}` or `]`, leaving string contents alone. */
function stripTrailingCommas(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) {
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/** The environment a recipe command sees: no API keys or tokens from the host process. */
export function recipeEnv(host: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'SHELL']) {
    if (host[key] !== undefined) env[key] = host[key]
  }
  return env
}

function commandSteps(stage: string, value: unknown): RecipeStep[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [{ stage, argv: ['sh', '-c', value] }]
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string'))
    return [{ stage, argv: value as string[] }]
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.entries(value).flatMap(([name, v]) => commandSteps(`${stage}:${name}`, v))
  return []
}

/** Pick the recipe of a checkout, or `undefined` when it has none. */
export async function detectRecipe(checkout: string): Promise<EnvironmentRecipe | undefined> {
  for (const source of ['.devcontainer/devcontainer.json', '.devcontainer.json']) {
    const file = join(checkout, source)
    if (!(await exists(file))) continue
    let config: unknown
    try {
      config = parseJsonc(await readFile(file, 'utf8'))
    } catch (error) {
      throw new Error(`environment recipe ${source} is not valid JSON: ${(error as Error).message}`)
    }
    const object = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>
    return { kind: 'devcontainer', source, steps: LIFECYCLE.flatMap((stage) => commandSteps(stage, object[stage])) }
  }
  const script = '.openclaw/worktree-setup.sh'
  if (await exists(join(checkout, script)))
    return { kind: 'setup-script', source: script, steps: [{ stage: 'setup', argv: ['sh', script] }] }
  for (const [lock, argv] of LOCKFILES)
    if (await exists(join(checkout, lock))) return { kind: 'lockfile', source: lock, steps: [{ stage: 'install', argv }] }
  return undefined
}

/** Detect and run the recipe in `checkout`; a failing step throws an error naming its stage. */
export async function applyRecipe(
  checkout: string,
  options: { timeoutMs?: number } = {},
): Promise<EnvironmentRecipe | undefined> {
  const recipe = await detectRecipe(checkout)
  if (!recipe) return undefined
  for (const step of recipe.steps) {
    const [cmd, ...args] = step.argv
    try {
      await run(cmd as string, args, { cwd: checkout, env: recipeEnv(), timeout: options.timeoutMs ?? 600_000, maxBuffer: 8 * 1024 * 1024 })
    } catch (error) {
      const e = error as { message: string; stderr?: string }
      throw new Error(`environment recipe ${recipe.source}: ${step.stage} failed: ${(e.stderr || e.message).trim().slice(0, 500)}`)
    }
  }
  return recipe
}
