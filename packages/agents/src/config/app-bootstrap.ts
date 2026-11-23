import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { loadProjectEnv } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { resolveProfile } from '@theokit/sdk/persistence'

import { resolveSecretRefs } from '../auth/secret-refs.js'

/** What every step receives: the environment to mutate, the working directory and the app's home. */
export interface BootstrapContext {
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string
  readonly home: string
}

export interface BootstrapStep {
  readonly name: string
  readonly run: (ctx: BootstrapContext) => void | Promise<void>
}

export interface AppBootstrap {
  /**
   * Run every step once, in order. A second call returns the first call's promise, including when
   * that promise rejected: a bootstrap that failed is not retried by asking again.
   */
  run(ctx: BootstrapContext): Promise<{ ran: readonly string[] }>
  readonly steps: readonly string[]
  /** True after run() completed. Lets a module that resolves SDK paths assert it is not too early. */
  readonly done: boolean
}

/** A step threw. Names the step and keeps the original error as `cause`; later steps did not run. */
export class BootstrapStepError extends TheokitAgentError {
  override readonly name = 'BootstrapStepError'
  readonly step: string

  constructor(step: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`[@theokit/agents] bootstrap step "${step}" failed: ${detail}`, {
      code: 'bootstrap_step_failed',
      isRetryable: false,
      cause,
    })
    this.step = step
  }
}

/** Something that needs the bootstrap ran before it. Names the caller. */
export class BootstrapNotRunError extends TheokitAgentError {
  override readonly name = 'BootstrapNotRunError'

  constructor(caller: string) {
    super(`[@theokit/agents] ${caller} was called before the app bootstrap completed`, {
      code: 'bootstrap_not_run',
      isRetryable: false,
    })
  }
}

export function defineAppBootstrap(steps: readonly BootstrapStep[]): AppBootstrap {
  const seen = new Set<string>()
  for (const step of steps) {
    if (seen.has(step.name)) {
      throw new Error(`[@theokit/agents] defineAppBootstrap: duplicate step name "${step.name}"`)
    }
    seen.add(step.name)
  }
  const list = [...steps]
  let pending: Promise<{ ran: readonly string[] }> | undefined
  let done = false

  const execute = async (ctx: BootstrapContext): Promise<{ ran: readonly string[] }> => {
    // Yield first so `pending` is assigned before any step runs: a step that calls `run()` again
    // then gets this same promise instead of starting a second execution.
    await Promise.resolve()
    const ran: string[] = []
    for (const step of list) {
      try {
        await step.run(ctx)
      } catch (cause) {
        throw new BootstrapStepError(step.name, cause)
      }
      ran.push(step.name)
    }
    done = true
    return { ran }
  }

  return {
    run(ctx) {
      pending ??= execute(ctx)
      return pending
    },
    steps: list.map((s) => s.name),
    get done() {
      return done
    },
  }
}

/** Throws {@link BootstrapNotRunError} naming `caller` unless `bootstrap.run()` has completed. */
export function assertBootstrapped(bootstrap: AppBootstrap, caller: string): void {
  if (!bootstrap.done) throw new BootstrapNotRunError(caller)
}

/**
 * Loads `<cwd>/.env` into `ctx.env` without overwriting set variables, then restores the SDK's
 * sovereign keys (`SOVEREIGN_ENV_KEYS`) through `loadProjectEnv`. A missing file is not an error.
 */
export const projectEnvStep: BootstrapStep = {
  name: 'project-env',
  run(ctx) {
    loadProjectEnv(ctx.env, () => {
      const file = join(ctx.cwd, '.env')
      if (!existsSync(file)) return
      for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
        ctx.env[key] ??= value
      }
    })
  },
}

const SDK_HOME_VARIABLES = ['THEOKIT_HOME', 'THEOKIT_AUTH_HOME'] as const

/** `sdkHomeStep` with `onConflict: 'refuse'` found an SDK home variable already set. Names it, never its value. */
export class SdkHomeConflictError extends TheokitAgentError {
  override readonly name = 'SdkHomeConflictError'
  readonly variable: string

  constructor(variable: string) {
    super(`[@theokit/agents] ${variable} is already set; sdkHomeStep refuses to override it`, {
      code: 'sdk_home_conflict',
      isRetryable: false,
    })
    this.variable = variable
  }
}

export type SdkHomeStepOptions = ({ readonly dirName: string } | { readonly profile: string }) & {
  /** A variable already set in `ctx.env` (even empty): `'refuse'` fails, `'env-wins'` keeps it. Default `'env-wins'`. */
  readonly onConflict?: 'refuse' | 'env-wins'
}

/**
 * Points `THEOKIT_HOME` and `THEOKIT_AUTH_HOME` at one directory: `<ctx.home>/<dirName>`, or the
 * SDK profile directory `<ctx.home>/.theokit/profiles/<profile>`. Both variables are checked before
 * either is written. Creates no directories.
 */
export function sdkHomeStep(options: SdkHomeStepOptions): BootstrapStep {
  const policy = options.onConflict ?? 'env-wins'
  return {
    name: 'sdk-home',
    run(ctx) {
      const dir =
        'profile' in options
          ? resolveProfile(options.profile, {
              profilesRoot: join(ctx.home, '.theokit', 'profiles'),
            }).directory
          : join(ctx.home, options.dirName)
      if (policy === 'refuse') {
        for (const variable of SDK_HOME_VARIABLES) {
          if (ctx.env[variable] !== undefined) throw new SdkHomeConflictError(variable)
        }
      }
      for (const variable of SDK_HOME_VARIABLES) ctx.env[variable] ??= dir
    },
  }
}

/**
 * Replaces every `ctx.env` value that is a secret reference with the value read from its store
 * (the built-in stores of `resolveSecretRefs`). `ctx.env` changes only after every reference resolved.
 */
export function secretRefsStep(): BootstrapStep {
  return {
    name: 'secret-refs',
    async run(ctx) {
      const { env } = await resolveSecretRefs(ctx.env)
      for (const [key, value] of Object.entries(env)) {
        if (value !== undefined && ctx.env[key] !== value) ctx.env[key] = value
      }
    },
  }
}
