import {
  defineAppBootstrap,
  projectEnvStepWith,
  type BootstrapContext,
} from '@theokit/agents/config'

import { installAuthHome } from '../auth/index.js'
import { installConfiguredHome, resolveEffectiveConfig } from '../config/index.js'
import { installClaudeProjectDir } from '../hooks/index.js'

export interface BootstrapSurfaceOptions {
  readonly env: Record<string, string | undefined>
  /** The directory the operator selected. Call this AFTER `-C` has changed it. */
  readonly cwd: string
  readonly home: string
  readonly onWarn?: (message: string) => void
}

/**
 * Keys a project `.env` may never set, on top of the SDK's sovereign keys (which the framework's
 * `projectEnvStepWith` already protects).
 */
export const THEOCODE_PROTECTED_ENV_KEYS: readonly string[] = [
  'THEOCODE_TRUST_ALL_DIRS',
  'THEOKIT_TRUST_ALL_DIRS',
  'THEOCODE_HOME',
  'THEOKIT_HOME',
  'THEOKIT_AUTH_HOME',
]

/**
 * The startup steps every surface (CLI, TUI, ACP) runs, in one place so they cannot drift apart.
 *
 * Call it after the working directory is chosen and BEFORE anything resolves an SDK path: the home
 * decides which directory the transcripts, the trust store and the collector use, and a later call
 * would move the root out from under whatever already read it. Await it: each call builds its own
 * framework bootstrap, so one call per entry runs every step exactly once.
 *
 * Returns the context the steps ran on; `projectEnv` names the keys `.env` loaded and refused.
 */
export async function bootstrapSurface(opts: BootstrapSurfaceOptions): Promise<BootstrapContext> {
  const { env, cwd, home } = opts
  const onWarn = opts.onWarn ?? ((m: string) => process.stderr.write(`${m}\n`))
  const ctx: BootstrapContext = { env, cwd, home }
  await defineAppBootstrap([
    // `.env` is read from the selected cwd.
    projectEnvStepWith({ protectedKeys: THEOCODE_PROTECTED_ENV_KEYS }),
    {
      name: 'configured-home',
      run: () => {
        installConfiguredHome({ env, home, read: () => resolveEffectiveConfig({ cwd }), onWarn })
      },
    },
    // `installAuthHome` (not `ensureAuthHome`): this must WRITE the variable (B-034).
    { name: 'auth-home', run: () => installAuthHome(env, home) },
    // Hooks need CLAUDE_PROJECT_DIR — see `claude-project-dir.ts`.
    { name: 'claude-project-dir', run: () => installClaudeProjectDir(env, cwd) },
  ]).run(ctx)
  return ctx
}
