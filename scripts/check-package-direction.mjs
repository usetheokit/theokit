#!/usr/bin/env node
/**
 * Dependency-CYCLE guard.
 *
 * `theokit` (packages/theo) is the PRINCIPAL project. A package the principal
 * CONSUMES (`@theokit/agents`, `@theokit/http`, …) MUST NEVER depend back on it
 * — that closes a cycle. A package the principal does NOT consume is free to
 * depend on it: an adapter that sits ABOVE the principal (`@theokit/tauri`, the
 * desktop transport glue per ADR-0055) is a legitimate consumer, exactly like
 * the fixtures and template apps this script already exempts.
 *
 * The consumed set is READ FROM the principal's own manifest, so the guard stays
 * correct as packages come and go — no hand-kept allowlist to drift (M56).
 *
 * A `theokit` peerDependency on `@theokit/http` (removed 2026-06-22, ADR 0030)
 * created a circular graph (theokit → @theokit/http → theokit) and made every
 * `theokit` minor cascade `@theokit/http` + `@theokit/agents` to a spurious
 * MAJOR bump via changesets' peer-dependent rule. This guard stops that class
 * of regression at CI time.
 *
 * Scope: the `packages` subdirectories (the publishable libraries). Private
 * consumer artifacts under `fixtures` and the create-* template trees are
 * example apps that legitimately consume `theokit` and are NOT checked here.
 *
 * Was a blanket "no sub-package may depend on the principal" until M56, which
 * flagged `@theokit/tauri` — a package the principal does not consume, so no
 * cycle and no changesets cascade. Enforcing the proxy instead of the invariant
 * produced a permanently-red gate, and a gate nobody can make green is a gate
 * nobody reads.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const PRINCIPAL = 'theokit'
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']

/** Packages the principal consumes — a back-dependency from any of these closes a cycle. */
function principalDependents() {
  const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, 'theo', 'package.json'), 'utf8'))
  const consumed = new Set()
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) consumed.add(name)
  }
  return consumed
}

const CONSUMED_BY_PRINCIPAL = principalDependents()
const violations = []

for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgPath = join(PACKAGES_DIR, entry.name, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    continue // no package.json in this dir
  }
  if (pkg.name === PRINCIPAL) continue // the principal may not depend on itself; nothing to check
  // Only a package the principal CONSUMES can close a cycle by depending back on it.
  if (!CONSUMED_BY_PRINCIPAL.has(pkg.name)) continue

  for (const field of DEP_FIELDS) {
    const range = pkg[field]?.[PRINCIPAL]
    if (range !== undefined) {
      violations.push(
        `${pkg.name} (packages/${entry.name}) declares ${field}.${PRINCIPAL} = "${range}"`,
      )
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    '✗ Dependency CYCLE — a package the principal consumes depends back on `theokit` (ADR 0030):\n',
  )
  for (const v of violations) process.stderr.write(`  - ${v}\n`)
  process.stderr.write(
    '\nFix: remove the `theokit` dependency. A package theokit consumes must never depend back on it.\n',
  )
  process.exit(1)
}

process.stdout.write(
  `✓ Dependency direction: no cycle. Checked ${CONSUMED_BY_PRINCIPAL.size} package(s) the principal consumes.\n`,
)
