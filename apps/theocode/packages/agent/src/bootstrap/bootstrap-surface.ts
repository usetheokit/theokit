import { installAuthHome } from '../auth/index.js'
import { installConfiguredHome, loadProjectEnv, resolveEffectiveConfig } from '../config/index.js'
import { installClaudeProjectDir } from '../hooks/index.js'

export interface BootstrapSurfaceOptions {
  readonly env: Record<string, string | undefined>
  /** The directory the operator selected. Call this AFTER `-C` has changed it. */
  readonly cwd: string
  readonly home: string
  readonly onWarn?: (message: string) => void
}

/**
 * The startup steps every surface (CLI, TUI, ACP) runs, in one place so they cannot drift apart.
 *
 * Call it after the working directory is chosen and BEFORE anything resolves an SDK path: the home
 * decides which directory the transcripts, the trust store and the collector use, and a later call
 * would move the root out from under whatever already read it.
 */
export function bootstrapSurface(opts: BootstrapSurfaceOptions): void {
  const { env, cwd, home } = opts
  // `.env` is read from the CWD at call time.
  loadProjectEnv(env)
  installConfiguredHome({
    env,
    home,
    read: () => resolveEffectiveConfig({ cwd }),
    onWarn: opts.onWarn ?? ((m) => process.stderr.write(`${m}\n`)),
  })
  // `installAuthHome` (not `ensureAuthHome`): this must WRITE the variable (B-034).
  installAuthHome(env, home)
  // Hooks need CLAUDE_PROJECT_DIR — see `claude-project-dir.ts`.
  installClaudeProjectDir(env, cwd)
}
