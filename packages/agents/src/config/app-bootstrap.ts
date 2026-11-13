import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { loadProjectEnv } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'

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
