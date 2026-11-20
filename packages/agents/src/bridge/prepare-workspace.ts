import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

/** The one recipe that prepares a fresh checkout, and the steps it runs in order. */
export interface WorkspaceRecipe {
  readonly kind: 'devcontainer' | 'setup-script' | 'lockfile'
  readonly source: string
  /** Each step runs its commands in parallel and finishes before the next step starts. */
  readonly steps: readonly {
    readonly stage: string
    readonly commands: readonly (string | string[])[]
  }[]
}

/** Runs one command in `cwd`. A string goes through a shell, an array is an argv. */
export type RecipeExec = (command: string | string[], cwd: string) => Promise<void>

/** A recipe command failed (or its devcontainer file was unreadable). The original is the `cause`. */
export class WorkspaceRecipeError extends TheokitAgentError {
  override readonly name = 'WorkspaceRecipeError'
  readonly source: string
  readonly stage: string
  constructor(source: string, stage: string, detail: string, options: { cause?: unknown } = {}) {
    super(`[@theokit/agents] workspace recipe ${source}: ${stage} failed: ${detail}`, {
      code: 'WORKSPACE_RECIPE_FAILED',
      isRetryable: false,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    })
    this.source = source
    this.stage = stage
  }
}

const DEVCONTAINER_FILES = ['.devcontainer/devcontainer.json', '.devcontainer.json']
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
const DEFAULT_TIMEOUT_MS = 10 * 60_000

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** Strips comments and trailing commas from JSONC, leaving string contents alone. */
function stripJsonc(text: string): string {
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
      const end = text.indexOf('*/', i + 2)
      if (end < 0) break
      i = end + 1 // eslint-disable-line sonarjs/updated-loop-counter -- skips the comment body
    } else out += c
  }
  let result = ''
  inString = false
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (inString) {
      result += c
      if (c === '\\') result += out[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      result += c
    } else if (c === ',') {
      let j = i + 1
      while (j < out.length && /\s/.test(out[j])) j++
      if (out[j] !== '}' && out[j] !== ']') result += c
    } else result += c
  }
  return result
}

function commandsOf(value: unknown): (string | string[])[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value]
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((v) => typeof v === 'string') ? [value] : []
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap(commandsOf)
  return []
}

async function devcontainerRecipe(root: string, source: string): Promise<WorkspaceRecipe> {
  let config: Record<string, unknown>
  try {
    config = JSON.parse(stripJsonc(await readFile(join(root, source), 'utf8'))) as Record<
      string,
      unknown
    >
  } catch (error) {
    throw new WorkspaceRecipeError(
      source,
      'parse',
      error instanceof Error ? error.message : String(error),
      { cause: error },
    )
  }
  const steps = LIFECYCLE.map((stage) => ({ stage, commands: commandsOf(config[stage]) })).filter(
    (step) => step.commands.length > 0,
  )
  return { kind: 'devcontainer', source, steps }
}

/**
 * Picks the single recipe for a checkout, or `undefined` when it has none. Order: a devcontainer
 * (`.devcontainer/devcontainer.json`, then `.devcontainer.json`), the first existing path of
 * `setupScripts` (default none), then a lockfile when `node_modules` is absent.
 */
export async function detectWorkspaceRecipe(
  root: string,
  options: { setupScripts?: readonly string[] } = {},
): Promise<WorkspaceRecipe | undefined> {
  for (const source of DEVCONTAINER_FILES) {
    if (await exists(join(root, source))) return devcontainerRecipe(root, source)
  }
  for (const source of options.setupScripts ?? []) {
    if (await exists(join(root, source))) {
      return {
        kind: 'setup-script',
        source,
        steps: [{ stage: 'setup', commands: [['sh', source]] }],
      }
    }
  }
  if (await exists(join(root, 'node_modules'))) return undefined
  for (const [file, command] of LOCKFILES) {
    if (await exists(join(root, file))) {
      return { kind: 'lockfile', source: file, steps: [{ stage: 'install', commands: [command] }] }
    }
  }
  return undefined
}

function execCommand(timeoutMs: number): RecipeExec {
  return (command, cwd) =>
    new Promise((resolve, reject) => {
      const [file, args] =
        typeof command === 'string' ? ['sh', ['-c', command]] : [command[0], command.slice(1)]

      execFile(
        file,
        args,
        { cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
        (error, _out, stderr) => {
          if (!error) {
            resolve()
            return
          }
          const text = stderr.trim()
          reject(text ? new Error(text, { cause: error }) : error)
        },
      )
    })
}

function withTimeout(
  run: Promise<void>,
  timeoutMs: number,
  command: string | string[],
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${typeof command === 'string' ? command : command.join(' ')} timed out after ${timeoutMs} ms`,
        ),
      )
    }, timeoutMs)
  })
  return Promise.race([run, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

/**
 * Detects the recipe for `path` and runs it: steps in order, each step's commands in parallel, each
 * command bounded by `timeoutMs` (default 10 minutes). Returns the recipe it ran, or `undefined`.
 * A failing command throws `WorkspaceRecipeError` naming the source and stage, with the original
 * error as `cause`.
 */
export async function prepareWorkspace(
  path: string,
  options: { exec?: RecipeExec; setupScripts?: readonly string[]; timeoutMs?: number } = {},
): Promise<WorkspaceRecipe | undefined> {
  const recipe = await detectWorkspaceRecipe(path, {
    ...(options.setupScripts ? { setupScripts: options.setupScripts } : {}),
  })
  if (!recipe) return undefined
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const exec = options.exec ?? execCommand(timeoutMs)
  for (const step of recipe.steps) {
    try {
      await Promise.all(
        step.commands.map((command) =>
          withTimeout(
            Promise.resolve().then(() => exec(command, path)),
            timeoutMs,
            command,
          ),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new WorkspaceRecipeError(recipe.source, step.stage, detail, { cause: error })
    }
  }
  return recipe
}
