/**
 * `theocode migrate-config` — converts every leftover `config.toml` into `settings.json`.
 *
 * Reachable BEFORE the bootstrap, deliberately. The loader refuses to start when a `config.toml` is
 * stranded and names this command in the refusal; if the command ran after configuration resolution
 * it would be blocked by the very refusal it exists to clear, and the operator would have no way out
 * but to read the source.
 *
 * BOTH SCOPES, for the same reason. Measured on the first end-to-end run: a stranded user-level
 * `config.toml` refused the start, this command scanned only the project directory, printed
 * "converted …" about a different file, and the refusal kept firing. An instruction that runs,
 * succeeds, and leaves the operator exactly where they were is worse than no instruction.
 */
import { homedir } from 'node:os'
import process from 'node:process'

import { findStrandedConfigs, homeStateDir, migrateConfigFile } from '@theocode/agent/config'

export function migrateConfigCommand(
  cwd: string,
  opts: { userDir?: string; env?: Record<string, string | undefined> } = {},
): void {
  const env = opts.env ?? process.env
  const userDir = opts.userDir ?? homedir()
  // The loader's own roots, resolved the loader's way — `THEOKIT_HOME` moves this product's state
  // directory, and converting a file the loader does not read is the same failure in reverse.
  const found = [
    ...findStrandedConfigs(cwd),
    ...findStrandedConfigs(userDir),
    ...findStrandedConfigs(homeStateDir(env, userDir)),
  ]
  const unique = [...new Set(found)]

  if (unique.length === 0) {
    process.stdout.write('nothing to convert: no config.toml in the project or the user directory\n')
    return
  }
  // Per file, and a failure on one never stops the others. Measured on a real run: the project root
  // already held a `settings.json`, the conversion threw over it, and the loop died BEFORE reaching
  // the user root — the very scope the refusal had named. The operator was then told the command
  // failed, about a file they had not asked about, while the file blocking their start went untouched.
  let converted = 0
  let failed = 0
  for (const from of unique) {
    try {
      process.stdout.write(`converted ${from} -> ${migrateConfigFile(from)}\n`)
      converted += 1
    } catch (err) {
      failed += 1
      process.stdout.write(`SKIPPED ${from}: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }
  if (converted > 0) {
    process.stdout.write(
      'the original config.toml files were left in place — delete them once you have checked the result\n',
    )
  }
  // Non-zero only when something was left undone, so a script can tell "all clear" from "look at
  // this". Converting some and skipping others is still a state the operator has to act on.
  if (failed > 0) process.exitCode = 1
}
