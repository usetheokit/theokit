import { homedir } from 'node:os'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/agents'

/**
 * The directory this product keeps its state in, under the operator's home.
 *
 * `.theokit` is the framework's own name and stays the default: it is where every existing
 * installation already has its transcripts, its trust store and its hook approvals, and moving that
 * by default would strand all of it.
 */
export const DEFAULT_HOME_DIR = '.theokit'

/**
 * The root this product used for the operator's config and instructions before `home_dir` existed.
 * For those, READ and never written.
 *
 * `#65` argued the split — "`.theokit/` inside a PROJECT is the framework's directory, but what this
 * product owns in the operator's home is `.theocode/`" — and that argument was sound while there was
 * no way to name one root. `home_dir` is that way, and keeping a second root it cannot reach makes
 * the key a half-truth. The split had already cost a duplicated credential store: measured
 * 2026-09-04, `~/.theokit/auth.json` sat nine days stale beside the live `~/.theocode/auth.json`,
 * unread and unrotated.
 *
 * ## The credential is the exception, and it is written here on every sign-in
 *
 * This comment used to say "READ, never written" without qualification, and that was false of the
 * one file under this root that matters most. `auth/oauth-config.ts` names this directory as the
 * credential store's `dirName`, and `installAuthHome` points the SDK at it, so a sign-in writes
 * `<home>/.theocode/auth.json` today.
 *
 * The behaviour is deliberate, not leftover: the SDK's own OAuth store is `<home>/.theokit/auth.json`
 * (`auth/credentials.ts` § `installAuthHome`), and two writers sharing one file is the collision the
 * separate name avoids. What was wrong was only the claim about it — stated here, in the file that
 * defines the roots, where a reader would most reasonably trust it and conclude that nothing writes
 * to this directory. Pinned by `auth/credentials.test.ts` so the two cannot drift apart again.
 */
export const LEGACY_HOME_DIR = '.theocode'

/**
 * The one directory this product keeps its state in, under the operator's home.
 *
 * `THEOKIT_HOME` is read rather than the config key because both surfaces install it at bootstrap
 * from that key, and the SDK reads the same variable — one resolved answer instead of a second
 * resolution that can disagree with the first.
 */
export function homeStateDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  return env.THEOKIT_HOME ?? join(home, DEFAULT_HOME_DIR)
}

/**
 * Its own error rather than `ConfigError`, and the reason is structural.
 *
 * `config.ts` imports this module for the default and the validator, so importing `ConfigError` back
 * from it closes a cycle — caught by `npm run depcruise` on the first run. Extending the SDK base
 * keeps the error TYPED, which `rules/error-handling.md` asks for and a plain `Error` would give up.
 *
 * NOT exported: nothing catches it by type today, and knip refused the orphan export. It stays a
 * class rather than becoming a plain Error because the type is what a future catcher would need,
 * and adding it back is one keyword.
 */
class HomeDirError extends TheokitAgentError {
  override readonly name = 'HomeDirError'
}

/**
 * A NAME, never a path.
 *
 * `.claude` and `.theocode` are names under the operator's home. Accepting an arbitrary path would
 * let a typo in a config file point the transcript root — and therefore the DELETE path — at `/etc`
 * or at a project directory. Input validation at the boundary is the one thing the parsimony ladder
 * never trades away.
 */
export function isValidHomeDirName(name: string): boolean {
  if (name.trim() !== name || name.length === 0) return false
  if (name === '.' || name === '..') return false
  return !/[/\\]/.test(name)
}

/**
 * Point the SDK's state root at the directory this product was configured to use.
 *
 * `THEOKIT_HOME` and not `sessionDir`, deliberately. The SDK exposes both, and they answer different
 * halves of one fact: `sessionDir` is where transcripts are WRITTEN, `THEOKIT_HOME` is what
 * `projectsRoot()` resolves for the collector that DELETES them. Setting only the first was measured
 * on 2026-09-04 to leave the sweep reporting `0 would remove; 0 kept` over a root nothing writes to
 * any more. One variable that both halves already read cannot disagree with itself.
 *
 * An explicit `THEOKIT_HOME` WINS. An operator who exports it is addressing the SDK directly, and a
 * config key that overrode that would make the environment silently inert — the same reasoning
 * `ensureAuthHome` records for reading `env.X ?? default` rather than assigning.
 *
 * An invalid name THROWS rather than falling back to the default: falling back moves the state root
 * without saying so, and the operator's transcripts appear to have vanished when in fact the product
 * is looking somewhere they never asked for.
 */
export function installTheokitHome(
  env: Record<string, string | undefined>,
  home: string,
  name: string = DEFAULT_HOME_DIR,
): string {
  if (!isValidHomeDirName(name)) {
    throw new HomeDirError(
      `home_dir: ${JSON.stringify(name)} is not a directory name — expected a single segment ` +
        `under your home, such as ${JSON.stringify(DEFAULT_HOME_DIR)} or ".claude"`,
    )
  }
  const resolved = env.THEOKIT_HOME ?? join(home, name)
  env.THEOKIT_HOME = resolved
  return resolved
}
