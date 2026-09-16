/**
 * `config.toml` → `settings.json`, the one-way conversion the loader's refusal names.
 *
 * The loader stopped reading TOML when `settings.json` replaced it, and a replacement that leaves
 * the old file in place without saying so drops the operator's whole configuration in silence. So
 * the loader refuses and names this command — which means this command has to exist and has to
 * work, or the refusal is a fabricated mechanism pointing at nothing.
 *
 * Two decisions worth stating:
 *
 *   - The conversion goes through `configSchema`, the SAME schema the loader parses with. A
 *     hand-written key map would drift, and the way it would drift is the expensive one: it accepts
 *     something the loader rejects, so the operator is told the file was converted and meets the
 *     failure on the next command, against a file they did not write.
 *   - The original is left in place, and an existing `settings.json` is never overwritten. Both
 *     sides of a configuration migration are irreplaceable to the person who wrote them; refusing
 *     costs one `rm`, overwriting costs whatever they had.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { ConfigError, configSchema, toConfigError } from './config.js'
import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR } from './home-dir.js'

/** Every root this product has ever read a `config.toml` from, in the order it read them. */
const ROOTS = [DEFAULT_HOME_DIR, LEGACY_HOME_DIR] as const

/**
 * The `config.toml` files still present under `dir` — both in its named roots and directly in it.
 * The bare case is for `THEOKIT_HOME`, which names the state directory itself rather than its parent.
 */
export function findStrandedConfigs(dir: string): string[] {
  const candidates = [
    ...ROOTS.map((root) => join(dir, root, 'config.toml')),
    join(dir, 'config.toml'),
  ]
  return candidates.filter((p) => existsSync(p))
}

/** Convert one `config.toml` and return the path of the `settings.json` written beside it. */
export function migrateConfigFile(from: string): string {
  const to = join(dirname(from), 'settings.json')

  let parsed: unknown
  try {
    parsed = parseToml(readFileSync(from, 'utf8'))
  } catch (err) {
    throw new ConfigError(`malformed TOML at ${from}: ${(err as Error).message}`)
  }

  let values: unknown
  try {
    values = configSchema.parse(parsed)
  } catch (err) {
    throw toConfigError(err, from)
  }

  // `wx` fails if the path exists, decided by the OS in the same call that writes — so existence
  // is not checked separately at all. An `existsSync` above it read better and could not survive
  // the gap between the check and the write, which is the window `js/file-system-race` names; and
  // keeping both left the scanner seeing check-then-use however atomic the write had become.
  //
  // The message an operator needs is reproduced from the failure rather than predicted before it,
  // which is also the only version that can be true: the file may appear while the TOML is parsed.
  try {
    writeFileSync(to, `${JSON.stringify(values, null, 2)}\n`, { flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ConfigError(`${to} already exists — delete it first, or convert ${from} by hand.`)
    }
    throw err
  }
  return to
}
