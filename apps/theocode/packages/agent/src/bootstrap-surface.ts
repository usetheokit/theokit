import { installAuthHome } from './auth/credentials.js'
import { loadProjectEnv } from './config/project-env.js'
import { installConfiguredHome } from './config/install-home.js'
import { resolveEffectiveConfig } from './config/effective-config.js'
import { installClaudeProjectDir } from './hooks/claude-project-dir.js'

/**
 * The startup steps every surface (CLI, TUI, ACP) runs, in one order.
 *
 * Call it AFTER the working directory is final (`-C` applied) and BEFORE anything resolves an SDK
 * path: the home decides which directory transcripts, the trust store and the collector use, and a
 * later call would move the root out from under whatever already read it.
 *
 * 1. `loadProjectEnv` — the project `.env` (sovereign keys such as THEOCODE_HOME are preserved).
 * 2. `installConfiguredHome` — THEOCODE_HOME / `home_dir` to the SDK's state root.
 * 3. `installAuthHome` — point the SDK at this product's credential store (B-034).
 * 4. `installClaudeProjectDir` — CLAUDE_PROJECT_DIR for hooks.
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
  installAuthHome(opts.env, opts.home)
  installClaudeProjectDir(opts.env, opts.cwd)
}
