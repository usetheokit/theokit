import { installAuthHome } from '../auth/credentials.js'
import { installConfiguredHome } from '../config/install-home.js'
import { resolveEffectiveConfig } from '../config/effective-config.js'
import { installClaudeProjectDir } from '../hooks/claude-project-dir.js'

import { loadProjectEnv } from './project-env.js'

export { loadProjectEnv }

/**
 * The startup steps every surface (CLI, TUI, ACP) runs, in one order.
 *
 * Call it after the working directory is final and BEFORE anything resolves an SDK path: the home
 * it installs decides where transcripts, the trust store and the collector live.
 */
export function bootstrapSurface(opts: {
  readonly env: Record<string, string | undefined>
  readonly cwd: string
  readonly home: string
  readonly onWarn?: (message: string) => void
}): void {
  const { env, cwd, home } = opts
  // `.env` is read from the process directory at call time; it must come first so the steps below
  // see what it supplies (protected keys keep their real values — see project-env.ts).
  loadProjectEnv(env)
  installConfiguredHome({
    env,
    home,
    read: () => resolveEffectiveConfig({ cwd }),
    onWarn: opts.onWarn ?? ((m) => process.stderr.write(`${m}\n`)),
  })
  installAuthHome(env, home)
  installClaudeProjectDir(env, cwd)
}
