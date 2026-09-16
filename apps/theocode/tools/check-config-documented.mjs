#!/usr/bin/env node
/**
 * Every key an operator can set must be findable in the README.
 *
 * A knob that exists and cannot be discovered is worse than one that does not exist: the operator
 * hits the default, has no way to learn there is an alternative, and concludes the behaviour is
 * fixed. `shell_timeout_ms` was added in this release precisely because a hard-coded bound with no
 * knob was a finding (SD-04.10); shipping a knob nobody can find would reproduce the finding with
 * extra steps.
 *
 * WHY THIS ONE IS MECHANISED AND ITS SIBLING IS NOT. The obvious neighbour — "every shipped backlog
 * item appears in the CHANGELOG" — was measured before being built and rejected: 20 of 147 shipped
 * items legitimately have no entry (dead-code removal, a test fix, an export change), and the
 * CHANGELOG rule forbids mixing internal refactors into a consumer-facing log. A gate there would
 * have enforced an anti-pattern. This invariant was measured the same way and has zero exceptions.
 */
import { existsSync, readFileSync } from 'node:fs'

// The list moved out of `config.ts` when `settings-load.ts` was split from it and the two started
// importing each other; `depcruise` refused the cycle and both now read the list from here. The
// guard follows the source of truth rather than the file that re-exports it — pointing at the
// re-export would make this pass on a stale copy the day someone adds one.
const SCHEMA = 'packages/agent/src/config/config-contract.ts'
const README = 'README.md'
const CLI = 'packages/cli/src/main.ts'

/** The keys the config schema declares, read from its source rather than by importing it. */
export function schemaKeys(source) {
  const block = /CONFIG_SCHEMA_KEYS[^=]*=\s*\[(.*?)\]/s.exec(source)
  if (block === null) return []
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

/**
 * The modes the CLI dispatches on, from both forms its entry point uses.
 *
 * Two forms because the dispatch grew two: an early-return chain for the modes that own a
 * subcommand tree (`sessions`, `doctor`) and a switch for the rest. A parser that knew only the
 * switch would have missed exactly the mode that was undocumented.
 */
/**
 * What the ARGUMENT PARSER returns rather than what a user types.
 *
 * `error` is "you made a mistake" and `help` is `--help`. Neither is a subcommand, and demanding the
 * README document them would force it to name two words nobody can invoke. This is the one place
 * the guard subtracts, so it says why.
 */
const PARSER_OUTCOMES = new Set(['error', 'help'])

export function cliModes(source) {
  const guard = [...source.matchAll(/mode === '([a-z-]+)'/g)].map((m) => m[1])
  const cases = [...source.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1])
  return [...new Set([...guard, ...cases])].filter((m) => !PARSER_OUTCOMES.has(m))
}

/**
 * Keys the README never names.
 *
 * A key counts as documented in either form an operator might meet: the bare `key`, or the TOML
 * table header `[[key]]` that `hooks` is actually written as. Matching only the bare form would
 * report the one key whose documented spelling is the honest one.
 */
export function undocumentedKeys(keys, readme) {
  return keys.filter(
    (k) =>
      !readme.includes(`\`${k}\``) &&
      !readme.includes(`[[${k}]]`) &&
      // A name documented inside a longer backticked command counts: `sessions` is written
      // `sessions gc` wherever a reader meets it, because the bare word runs nothing. Demanding the
      // bare form would push the README towards being less accurate to satisfy the guard.
      !readme.includes(`\`${k} `),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(SCHEMA) || !existsSync(README)) process.exit(0)
  const keys = schemaKeys(readFileSync(SCHEMA, 'utf8'))
  if (keys.length === 0) {
    // Absence of keys is absence of measurement, never a pass: the parser drifting from the source
    // would otherwise report a clean bill of health over a file it failed to read.
    process.stderr.write(`${SCHEMA}: CONFIG_SCHEMA_KEYS not found — the guard could not read it\n`)
    process.exit(1)
  }
  const readme = readFileSync(README, 'utf8')
  const modes = existsSync(CLI) ? cliModes(readFileSync(CLI, 'utf8')) : []
  const surfaces = [
    { label: 'config keys', names: keys },
    { label: 'CLI modes', names: modes },
  ]

  let failed = false
  for (const { label, names } of surfaces) {
    const missing = undocumentedKeys(names, readme)
    if (missing.length === 0) {
      if (!quiet) process.stdout.write(`${README}: all ${String(names.length)} ${label} are documented\n`)
      continue
    }
    failed = true
    process.stderr.write(
      `${README} documents ${String(names.length - missing.length)}/${String(names.length)} ${label}. ` +
        `A user cannot discover: ${missing.join(', ')}\n`,
    )
  }
  if (failed) process.exit(1)
}
