#!/usr/bin/env node
/**
 * Dependency-direction guard.
 *
 * `theokit` (packages/theo) is the PRINCIPAL project. The library sub-packages
 * (`@theokit/http`, `@theokit/agents`, …) MUST NEVER depend on it — not as a
 * regular dependency, a peerDependency, nor a devDependency. The direction is
 * strictly main → libs, never libs → main.
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
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const PRINCIPAL = 'theokit'
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']

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
    '✗ Dependency-direction violation — library sub-packages must NEVER depend on the principal `theokit` (ADR 0030):\n',
  )
  for (const v of violations) process.stderr.write(`  - ${v}\n`)
  process.stderr.write(
    '\nFix: remove the `theokit` dependency. Libraries are consumed BY theokit, never the reverse.\n',
  )
  process.exit(1)
}

process.stdout.write(
  '✓ Dependency direction: no library sub-package depends on the principal `theokit`.\n',
)
