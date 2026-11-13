import { join } from 'node:path'

import { loadProjectEnv } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'

/** What every step receives: the environment to mutate, the working directory, and the app home. */
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
  /** Run every step once, in order. A second call returns the first call's promise. */
  run(ctx: BootstrapContext): Promise<{ ran: readonly string[] }>
  readonly steps: readonly string[]
  /** True after run() completed. Lets a module that resolves SDK paths assert it is not too early. */
  readonly done: boolean
}

/** A step threw. Names the step and keeps the cause; the steps after it did not run. */
export class BootstrapStepError extends TheokitAgentError {
  override readonly name = 'BootstrapStepError'
  readonly step: string
  constructor(step: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Bootstrap step "${step}" failed: ${detail}`, {
      code: 'bootstrap_step_failed',
      isRetryable: false,
      cause,
    })
    this.step = step
  }
}

/** A caller needed the bootstrap to have run and it had not. */
export class BootstrapNotRunError extends TheokitAgentError {
  override readonly name = 'BootstrapNotRunError'
  readonly caller: string
  constructor(caller: string) {
    super(`${caller} was called before the app bootstrap ran. Run the bootstrap first.`, {
      code: 'bootstrap_not_run',
      isRetryable: false,
    })
    this.caller = caller
  }
}

/**
 * Declare an app's setup once; every entry calls `run` and gets the same steps in the same order.
 * A duplicate step name throws here, at definition.
 */
export function defineAppBootstrap(steps: readonly BootstrapStep[]): AppBootstrap {
  const names = steps.map((s) => s.name)
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) throw new Error(`Duplicate bootstrap step name "${name}".`)
    seen.add(name)
  }
  const frozen = [...steps]
  let pending: Promise<{ ran: readonly string[] }> | undefined
  let done = false

  const execute = async (ctx: BootstrapContext): Promise<{ ran: readonly string[] }> => {
    const ran: string[] = []
    for (const step of frozen) {
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
    steps: names,
    get done() {
      return done
    },
  }
}

/** Throw {@link BootstrapNotRunError} naming `caller` unless `bootstrap.run()` has completed. */
export function assertBootstrapped(bootstrap: AppBootstrap, caller: string): void {
  if (!bootstrap.done) throw new BootstrapNotRunError(caller)
}

/**
 * Load the project `.env` from `ctx.cwd` through the SDK's `loadProjectEnv`, which restores the
 * sovereign keys afterwards so a project file can never set them.
 */
export const projectEnvStep: BootstrapStep = {
  name: 'project-env',
  run(ctx) {
    loadProjectEnv(ctx.env, () => {
      process.loadEnvFile(join(ctx.cwd, '.env'))
    })
  },
}
