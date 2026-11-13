import { installAuthHome } from '../auth/index.js'
import { installConfiguredHome, loadProjectEnv, resolveEffectiveConfig } from '../config/index.js'
import { installClaudeProjectDir } from '../hooks/index.js'

/**
 * The startup steps every surface (CLI, TUI, ACP entry) runs, in one order.
 *
 * Call it AFTER the working directory is chosen (`-C`) and BEFORE anything resolves an SDK path:
 * the configured home decides which directory transcripts, the trust store and the collector use.
 */
export function bootstrapSurface(opts: {
  readonly env: Record<string, string | undefined>
  readonly cwd: string
  readonly home: string
  readonly onWarn?: (message: string) => void
}): void {
  const { env, cwd, home } = opts
  loadProjectEnv(env)
  installConfiguredHome({
    env,
    home,
    read: () => resolveEffectiveConfig({ cwd }),
    onWarn: opts.onWarn ?? ((m) => process.stderr.write(`${m}\n`)),
  })
  // `installAuthHome`, not `ensureAuthHome`: this line has to WRITE the variable (B-034).
  installAuthHome(env, home)
  installClaudeProjectDir(env, cwd)
}
