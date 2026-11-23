import {
  defineAppBootstrap,
  projectEnvStepWith,
  type BootstrapContext,
  type ProjectEnvRecord,
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
 * `projectEnvStep` already restores).
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
 * would move the root out from under whatever already read it. Returns what the `.env` step loaded
 * and refused (key names only), the basis for labelling where a credential came from. Await it: each call builds its own
 * framework bootstrap, so one call per entry runs every step exactly once.
 */
export async function bootstrapSurface(opts: BootstrapSurfaceOptions): Promise<ProjectEnvRecord | undefined> {
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
  return ctx.projectEnv
}
