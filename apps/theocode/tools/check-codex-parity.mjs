#!/usr/bin/env node
/**
 * A Codex command this product neither implements nor answers is a `unknown command` waiting to
 * happen, and until this file existed nothing looked.
 *
 * B-158 — `packages/tui/src/commands/codex-names.ts` asserts which Codex commands have no local
 * equivalent, each with a sentence naming the nearest thing. That assertion is about another
 * product's surface and had no verifier. Measured 2026-09-09 against `@openai/codex@0.153.4`:
 * `recap` was new, and `approve` was a rename of `auto-review` which the map still carried under
 * the old name. Both answered `unknown command`.
 *
 * ## What it reads, and the one thing it must never do
 *
 * The Codex surface comes from `codex/codex-rs/tui/src/slash_command.rs` — a checkout, not a
 * release. That is the weakness and it is stated on every run: the output names the revision it
 * compared against, because the same measurement found that reading a month-old checkout reports a
 * clean surface while two commands are missing.
 *
 * The checkout is gitignored and absent in CI, so an absent input SKIPS. It never passes. A checker
 * that cannot be told apart from one that read nothing is the defect this file was written about,
 * one level up.
 *
 * ## The floors
 *
 * Both parses read source by pattern, and a pattern that stops matching returns an empty list
 * rather than an error. Empty means opposite things on the two sides — "Codex has no commands" and
 * "we implement nothing" — and neither looks wrong. `floorViolations` refuses to let a comparison
 * be trusted until both sides found a plausible number.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Codex's own debug hooks. Excluded by name rather than by a `^(debug|test)-` pattern: the pattern
 * reads as more general and is more fragile in the dangerous direction, because `debug-config` is a
 * real user-facing Codex command this product answers with a pointer.
 */
export const DEBUG_ONLY = Object.freeze(['debug-m-drop', 'debug-m-update', 'test-approval'])

/** Below these, a parse is treated as failed rather than as an answer. */
const FLOORS = Object.freeze({ codex: 40, builtin: 30, pointers: 15 })

const ENUM_PATH = 'codex/codex-rs/tui/src/slash_command.rs'
const REGISTRY_PATH = 'packages/tui/src/commands/registry.ts'
const NAMES_PATH = 'packages/tui/src/commands/codex-names.ts'

const kebab = (variant) => variant.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase()

/**
 * Command names declared by Codex's `SlashCommand` enum.
 *
 * Reads the enum BODY only. Below it sits `description()`, a match arm of `SlashCommand::Name =>`
 * pairs; reading past the closing brace would double every command and let a duplicate hide a real
 * absence.
 */
export function parseCodexCommands(rustSource) {
  const start = rustSource.indexOf('pub enum SlashCommand')
  if (start < 0) return []
  const body = rustSource.slice(start).split('\n}')[0]

  const names = []
  let override = null
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    // Both strum forms carry a name, and both are real here. `serialize` declares the string the
    // enum parses FROM; `to_string` declares the string it renders AS — which is the one a user
    // sees in the menu and types. `AutoReview` is annotated `to_string = "approve"`, so a parser
    // reading only `serialize` calls it `auto-review`, matches this product's stale pointer, and
    // reports no drift about the exact rename this item was raised for.
    //
    // THE ATTRIBUTE CAN CARRY BOTH, and the first version of this parser could not read that form.
    // `#[strum(to_string = "pwd", serialize = "cwd")]` requires no `)]` after the first value, so
    // the anchored pattern missed it entirely and the variant fell through to its kebab-cased name.
    // Codex uses the combined form three times today — `pwd`, `pets`, `stop` — and it went unnoticed
    // only because each happens to kebab-case to the same string. Fed `to_string = "renamed-thing"`
    // beside a `serialize`, the old parser returned the variant name: the `AutoReview -> approve`
    // defect this file was written to catch, alive inside the fix for it. Found by review, not by
    // the suite, because the test named for the behaviour used the `serialize` branch that already
    // worked.
    //
    // `to_string` wins when both are present: it is what the user sees and types.
    if (line.startsWith('#[strum(')) {
      const attr = line.slice('#[strum('.length)
      const rendered = /\bto_string\s*=\s*"([^"]+)"/.exec(attr)
      const parsedFrom = /\bserialize\s*=\s*"([^"]+)"/.exec(attr)
      if (rendered || parsedFrom) {
        override = (rendered ?? parsedFrom)[1]
        continue
      }
    }
    const variant = /^([A-Z][A-Za-z0-9]*),$/.exec(line)
    if (variant) {
      names.push(override ?? kebab(variant[1]))
      override = null
    }
  }
  return names
}

/** The two local surfaces: what this product implements, and what it answers with a pointer. */
export function parseLocalSurface(registryTs, codexNamesTs) {
  const builtin = new Set(
    [...registryTs.matchAll(/\{\s*name:\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]),
  )
  // Two entry shapes, both real: a multi-line tuple whose key sits on its own line, and a
  // single-line `['app', { … }]`. The first draft read only the first shape and missed five
  // entries — `app`, `experimental`, `keymap`, `pets`, `vim` — reporting each as unaccounted when
  // the map answers all five. A partial parse, which the floors do not catch: 24 pointers cleared
  // the floor of 15 while five were invisible. The floors catch a parser that found NOTHING; only
  // a test against the real file catches one that found MOST.
  const pointers = new Set([
    ...[...codexNamesTs.matchAll(/^\s*'([a-z][a-z0-9-]*)',\s*$/gm)].map((m) => m[1]),
    ...[...codexNamesTs.matchAll(/^\s*\[\s*'([a-z][a-z0-9-]*)',/gm)].map((m) => m[1]),
  ])
  return { builtin, pointers }
}

/**
 * The delta, in both directions.
 *
 * `staleHere` is the reverse question — a pointer naming a Codex command that no longer exists —
 * and it is what would have caught `auto-review` becoming `approve` a release earlier.
 */
export function unaccounted(codexNames, local) {
  const debug = new Set(DEBUG_ONLY)
  const codex = new Set(codexNames)
  return {
    missingHere: codexNames
      .filter((n) => !debug.has(n) && !local.builtin.has(n) && !local.pointers.has(n))
      .sort(),
    staleHere: [...local.pointers].filter((n) => !codex.has(n)).sort(),
  }
}

/**
 * Reasons the comparison must not be trusted yet, empty when both sides found a plausible number.
 *
 * Not a boolean: the message names which side failed and by how much, because "the parser broke"
 * and "Codex shrank" need different answers from a human.
 */
export function floorViolations(codexNames, local) {
  const out = []
  if (codexNames.length < FLOORS.codex) {
    out.push(
      `parsed ${codexNames.length} Codex command(s), floor is ${FLOORS.codex} — treating this as a ` +
        `failed parse of ${ENUM_PATH} rather than as an absence of drift`,
    )
  }
  if (local.builtin.size < FLOORS.builtin) {
    out.push(
      `parsed ${local.builtin.size} builtin name(s), floor is ${FLOORS.builtin} — a failed parse of ` +
        `${REGISTRY_PATH} would report every Codex command as unaccounted`,
    )
  }
  if (local.pointers.size < FLOORS.pointers) {
    out.push(
      `parsed ${local.pointers.size} pointer entr(ies), floor is ${FLOORS.pointers} — a failed parse ` +
        `of ${NAMES_PATH} would report every answered command as unaccounted`,
    )
  }
  return out
}

/**
 * The Codex checkout's revision, or `unknown`. A failing `git` costs the label, never the comparison.
 *
 * The `.git` check is not defensive noise. `git -C codex log` walks UP when `codex/` is not itself a
 * repository — a tarball, a vendored copy, a submodule not initialised — and answers with the
 * ENCLOSING repository's commit. Reproduced: a scaffold whose `codex/` had no `.git` printed
 * `compared against 3056039`, which was the host repo's own commit. The output would then be a
 * precise, confident fact about the wrong object, which is the exact failure this whole checker
 * exists to detect, one level up. `unknown revision` is the honest answer.
 */
function revisionOf(root) {
  if (!existsSync(join(root, 'codex', '.git'))) return 'unknown revision (codex/ is not a git checkout)'
  try {
    return execFileSync('git', ['-C', join(root, 'codex'), 'log', '-1', '--format=%h %ad', '--date=short'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown revision'
  }
}

function main(argv) {
  const quiet = argv.includes('--quiet')
  const root = process.env['CODEX_PARITY_ROOT'] ?? join(dirname(fileURLToPath(import.meta.url)), '..')
  const say = (line) => process.stdout.write(`${line}\n`)

  const enumFile = join(root, ENUM_PATH)
  if (!existsSync(enumFile)) {
    // Keyed on the FILE, not on `codex/`: a restructured or partial clone satisfies a directory
    // check and then throws on the read, which is a stack trace inside `pnpm lint` rather than this.
    say(`[codex-parity] SKIPPED — ${ENUM_PATH} not found. Clone Codex there to check parity.`)
    return 0
  }

  // Guarded like the Codex read above. EC-2 hardened that one against a stack trace inside
  // `pnpm lint`; these two were left bare, so a checkout missing either local source threw exactly
  // the shape that edge case says it prevents.
  for (const relative of [REGISTRY_PATH, NAMES_PATH]) {
    if (!existsSync(join(root, relative))) {
      say(`[codex-parity] ${relative} not found — cannot compare a surface that is not there.`)
      return 1
    }
  }
  const codex = parseCodexCommands(readFileSync(enumFile, 'utf8'))
  const local = parseLocalSurface(
    readFileSync(join(root, REGISTRY_PATH), 'utf8'),
    readFileSync(join(root, NAMES_PATH), 'utf8'),
  )

  const violations = floorViolations(codex, local)
  if (violations.length > 0) {
    for (const v of violations) say(`[codex-parity] ${v}`)
    return 1
  }

  const { missingHere, staleHere } = unaccounted(codex, local)
  if (missingHere.length === 0 && staleHere.length === 0) {
    if (!quiet) say(`[codex-parity] ${codex.length} commands accounted for (${revisionOf(root)})`)
    return 0
  }

  say(`[codex-parity] compared against ${revisionOf(root)}`)
  for (const name of missingHere) {
    say(`  /${name} — in Codex, in neither ${REGISTRY_PATH} nor ${NAMES_PATH}: answers 'unknown command'`)
  }
  for (const name of staleHere) {
    say(`  /${name} — answered here, absent from Codex: renamed or removed`)
  }
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
