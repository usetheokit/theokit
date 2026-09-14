#!/usr/bin/env node
/**
 * B-066 — the environment-variable list in `packages/agents/README.md` is CLOSED, and stays closed.
 *
 * ## Why a gate and not a review
 *
 * A closed list is a promise about ABSENCE: "not in this table" means "not read". That promise is
 * false the moment somebody adds a `process.env` read and forgets the table, and nothing about the
 * code failing tells them — the list keeps rendering, and the cost lands on the operator who
 * believed it. This is the same shape `check-doc-citations.mjs` exists for, one surface over.
 *
 * ## Both directions, deliberately
 *
 *   read but undeclared   — the list is incomplete, so "absent means not read" is a lie
 *   declared but unread   — the list advertises a variable nothing consults any more
 *
 * A one-way gate catches the first and lets the second rot in after the refactor that deleted the
 * read. The second is the quieter failure and the one an operator cannot detect by experiment.
 *
 * ## What it deliberately does not do
 *
 * It does not resolve imported constants, computed names, or destructuring — see the ADRs in
 * `records/plans/env-vars-accepted-and-ignored-plan.md`. Measured in this repository: one
 * indirection exists and it resolves inside its own file. A read this cannot resolve FAILS the gate
 * naming the `file:line`; it is never skipped, because a blind spot that passes silently is how a
 * gate stops being one.
 *
 * It reads the working tree with node's stdlib only — no network, no install, nothing outside this
 * repository.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compareAgainstList,
  readDeclaredList,
  scanEnvReads,
} from '../packages/agents/scripts/env-verdicts-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'packages/agents/src')
const README = join(ROOT, 'packages/agents/README.md')

function main() {
  const { names, unresolved } = scanEnvReads(SRC)

  if (unresolved.length > 0) {
    console.error('Environment reads this gate cannot resolve to a literal name:\n')
    for (const u of unresolved) console.error(`  ${u}`)
    console.error(
      '\nEach one is a variable the closed list cannot account for. Either name it through a const in\n' +
        'the same file, or widen the scanner — do not leave it unresolved, because the list then\n' +
        'claims completeness it does not have.',
    )
    process.exit(1)
  }

  let declared
  try {
    declared = readDeclaredList(README)
  } catch (error) {
    console.error(String(error.message))
    process.exit(1)
  }

  const { ok, readButUndeclared, declaredButUnread } = compareAgainstList(names, declared)

  if (ok) {
    console.log(
      `env-verdicts: ${names.length} variable(s) read, ${declared.length} declared, list is closed and current`,
    )
    for (const n of names) console.log(`  ${n}`)
    process.exit(0)
  }

  if (readButUndeclared.length > 0) {
    console.error('Read by the source and MISSING from the README table:\n')
    for (const n of readButUndeclared) console.error(`  ${n}`)
    console.error(
      '\nThe table says absence means "not read". While these are missing, that sentence is false.',
    )
  }

  if (declaredButUnread.length > 0) {
    console.error('\nDeclared in the README table and NO LONGER read by any source:\n')
    for (const n of declaredButUnread) console.error(`  ${n}`)
    console.error(
      '\nAn operator setting these would see nothing happen and have no way to know why.',
    )
  }

  process.exit(1)
}

main()
