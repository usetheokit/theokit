import { DEFAULT_HOME_DIR, installTheokitHome } from './home-dir.js'

/**
 * Point the SDK's state root at the configured directory, at bootstrap, tolerantly.
 *
 * This runs before anything else resolves an SDK path, which means it runs before the product has a
 * nice way to report anything. `resolveEffectiveConfig` throws on a malformed `config.toml`, and a
 * throw here kills the process at startup — the hazard `guardedSweepStart` exists for, one bootstrap
 * earlier.
 *
 * A config that cannot be read, or a name that is refused, installs the DEFAULT and REPORTS. That is
 * the safe direction rather than a swallow: the default is where every existing installation's state
 * already is, and the same broken file is about to be reported properly by the normal config path a
 * moment later. Choosing any other directory on the strength of a file we could not parse would move
 * the state root on a guess.
 */
export function installConfiguredHome(opts: {
  readonly env: Record<string, string | undefined>
  readonly home: string
  /** Reads the resolved config. Injected so bootstrap does not depend on how config is discovered. */
  readonly read: () => { home_dir?: string }
  readonly onWarn: (message: string) => void
}): void {
  let name = DEFAULT_HOME_DIR
  try {
    name = opts.read().home_dir ?? DEFAULT_HOME_DIR
  } catch (err) {
    opts.onWarn(
      `[home_dir] using ${DEFAULT_HOME_DIR} — the configuration could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  try {
    installTheokitHome(opts.env, opts.home, name)
  } catch (err) {
    opts.onWarn(
      `[home_dir] using ${DEFAULT_HOME_DIR} — ${err instanceof Error ? err.message : String(err)}`,
    )
    installTheokitHome(opts.env, opts.home)
  }
}
