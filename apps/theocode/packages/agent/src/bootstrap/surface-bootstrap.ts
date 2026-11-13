import { installAuthHome } from '../auth/index.js'
import { installConfiguredHome, loadProjectEnv, resolveEffectiveConfig } from '../config/index.js'
import { installClaudeProjectDir } from '../hooks/index.js'

type Env = Record<string, string | undefined>

/**
 * The startup steps every TheoCode surface (CLI, TUI, ACP entry) runs, in one order.
 *
 * Call it AFTER the working directory is final (`-C` has been applied) and BEFORE anything resolves
 * an SDK path: the project `.env` is read from the process directory at call time, and the home
 * decided here picks the transcript, trust-store and collector roots.
 */
export function bootstrapSurface(opts: {
  readonly env: Env
  readonly cwd: string
  readonly home: string
  readonly onWarn?: (message: string) => void
}): void {
  const onWarn = opts.onWarn ?? ((m: string) => void process.stderr.write(`${m}\n`))
  loadProjectEnv()
  installConfiguredHome({
    env: opts.env,
    home: opts.home,
    read: () => resolveEffectiveConfig({ cwd: opts.cwd }),
    onWarn,
  })
  // `installAuthHome`, not `ensureAuthHome`: the call must WRITE the variable (B-034).
  installAuthHome(opts.env, opts.home)
  installClaudeProjectDir(opts.env, opts.cwd)
}
