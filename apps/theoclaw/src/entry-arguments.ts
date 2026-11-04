/**
 * The process entry's arguments (B-692, FR-007): a Task Scheduler action carries no environment, so
 * `--config <path>` and `--profile <name>` set `THEOCLAW_CONFIG` and `THEOCLAW_PROFILE` before the
 * configuration is read. Nothing else is accepted.
 */

export type EntryArguments = { readonly ok: true } | { readonly ok: false; readonly error: string }

const FLAGS: Readonly<Record<string, string>> = {
  '--config': 'THEOCLAW_CONFIG',
  '--profile': 'THEOCLAW_PROFILE',
}

/** Applies the arguments to `env` only when every one is valid, so a refusal changes nothing. */
export function parseEntryArguments(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): EntryArguments {
  const found = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!
    // Own properties only: an inherited name such as `constructor` or `toString` is not a flag (#1143).
    const variable = Object.hasOwn(FLAGS, flag) ? FLAGS[flag] : undefined
    if (variable === undefined)
      return {
        ok: false,
        error: `unexpected argument ${flag}; expected --config <path> or --profile <name>`,
      }
    const value = argv[index + 1]
    if (value === undefined || Object.hasOwn(FLAGS, value))
      return { ok: false, error: `${flag} needs a value` }
    if (found.has(variable)) return { ok: false, error: `${flag} was given twice` }
    found.set(variable, value)
  }
  for (const [variable, value] of found) env[variable] = value
  return { ok: true }
}
