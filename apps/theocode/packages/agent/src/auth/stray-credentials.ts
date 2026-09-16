import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR, homeStateDir } from '../config/home-dir.js'
import { authFilePath } from './credentials.js'

/**
 * Credential files sitting in a state directory this product does NOT read.
 *
 * The one defect of the two-directory split that reaches beyond tidiness. Measured 2026-09-04:
 * `~/.theokit/auth.json` held a nine-day-old refresh token, written by the SDK before
 * `installAuthHome` pointed it at this product's store, and read by nothing since. A token no code
 * path touches does not stop being a token — it stops being one anybody notices.
 *
 * REPORTS, never deletes and never moves. Moving a live credential is the one step of this
 * unification that can log an operator out, or resolve to the stale copy instead of the fresh one,
 * and its only benefit is a tidier directory listing. Deleting is the operator's call to make about
 * their own credentials. So the store stays where the product writes it, and the leftover becomes
 * visible instead of silent.
 *
 * Reads no content. Existence and location are the whole answer, which is also why this can be
 * reported without any risk of a secret reaching a log.
 */
export function strayCredentialFiles(
  home: string,
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const authoritative = authFilePath(home, env)
  const roots = new Set([
    homeStateDir(env, home),
    join(home, DEFAULT_HOME_DIR),
    join(home, LEGACY_HOME_DIR),
  ])
  return [...roots]
    .map((root) => join(root, 'auth.json'))
    .filter((path) => path !== authoritative && existsSync(path))
}
