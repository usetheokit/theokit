import { installAuthHome } from '../auth/index.js'
import { installConfiguredHome, resolveEffectiveConfig } from '../config/index.js'
import { loadProjectEnv } from '../config/project-env.js'
import { installClaudeProjectDir } from '../hooks/index.js'

/**
 * The startup steps every surface (CLI, TUI, ACP entry) runs, in one place and one order.
 *
 * Call it after the working directory is final (after `-C`) and BEFORE anything resolves an SDK
 * path: `.env` is read from the CWD at call time, and the home decides which directory transcripts,
 * the trust store and the collector use.
 */
export function bootstrapSurface(opts: {
  readonly env: Record<string, string | undefined>
  readonly cwd: string
  readonly home: string
  readonly onWarn?: (message: string) => void
}): void {
  const onWarn = opts.onWarn ?? ((m: string) => void process.stderr.write(`${m}\n`))
  loadProjectEnv(opts.env)
  installConfiguredHome({
    env: opts.env,
    home: opts.home,
    read: () => resolveEffectiveConfig({ cwd: opts.cwd }),
    onWarn,
  })
  // `installAuthHome`, not `ensureAuthHome`: this call must WRITE the variable (B-034).
  installAuthHome(opts.env, opts.home)
  installClaudeProjectDir(opts.env, opts.cwd)
}
