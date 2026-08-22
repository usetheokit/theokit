#!/usr/bin/env node
/**
 * Release step — point the scaffold's template at the versions this release publishes.
 *
 * ## The failure this exists to prevent
 *
 * `packages/create-theokit/templates/default/package.json.tmpl` pinned `"theokit": "^0.48.3"` while
 * the repository was at `0.49.0`. A caret on a `0.x` version pins the MINOR, so that range excludes
 * every 0.49 build — and nothing moved it (usetheokit/theokit#424). Once `0.49.0` publishes,
 * `create-theokit` keeps scaffolding apps on the 0.48 line: the install succeeds, the app runs, it
 * is simply not the framework anyone thinks they installed. Silent by construction.
 *
 * `changeset version` bumps real package manifests. A `.tmpl` is not a manifest it manages, so the
 * pin had to be edited by hand, by someone who remembered.
 *
 * ## Why a release step and not a test
 *
 * The obvious guard — "the template range admits the workspace version" — is wrong, and it was
 * written and removed while fixing #420. Between a version bump and its publish the workspace is
 * legitimately AHEAD of npm: with the repo at `0.49.0` and nothing published, a template obeying
 * that rule would scaffold apps that cannot install at all.
 *
 * The property that holds is a release-time one: at the moment of publish, the template's range must
 * admit the version being published. That is exactly when this runs — after `changeset version` has
 * set the new numbers and before `changeset publish` sends them. The template travels INSIDE
 * `create-theokit`, which publishes in the same run, so a user can never receive a template pointing
 * at a version that is not there yet.
 *
 * Usage: `node scripts/sync-template-pins.mjs [--check]`
 *   --check  report drift and exit non-zero, changing nothing (for CI)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TEMPLATE = 'packages/create-theokit/templates/default/package.json.tmpl'

/** Name → version, for every package this repository publishes. */
function workspaceVersions() {
  const versions = new Map()
  for (const entry of readdirSync('packages', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const pkg = JSON.parse(readFileSync(join('packages', entry.name, 'package.json'), 'utf8'))
      if (pkg.private === true) continue
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
        versions.set(pkg.name, pkg.version)
      }
    } catch {
      // Not a package directory.
    }
  }
  return versions
}

/**
 * The range a template should carry for `version`.
 *
 * A caret, matching what the template already uses and what a scaffolded app wants: patch and — on
 * a `1.x` line — minor updates arrive without a re-scaffold.
 */
function rangeFor(version) {
  return `^${version}`
}

const template = readFileSync(TEMPLATE, 'utf8')
const versions = workspaceVersions()
const changed = []

let updated = template
for (const [name, version] of versions) {
  // Matches the dependency line for this exact package name, capturing its current range.
  const line = new RegExp(`("${name.replaceAll('/', '\\\\/')}"\\s*:\\s*)"([^"]+)"`, 'u')
  const match = line.exec(updated)
  if (match === null) continue

  const current = match[2]
  const wanted = rangeFor(version)
  if (current === wanted) continue

  changed.push(`${name}: ${current} -> ${wanted}`)
  updated = updated.replace(line, `$1"${wanted}"`)
}

if (changed.length === 0) {
  console.log('Template pins already match the versions this release publishes.')
  process.exit(0)
}

if (process.argv.includes('--check')) {
  console.error('Template pins do not match the versions this release publishes:\n')
  for (const c of changed) console.error(`  - ${c}`)
  console.error('\nRun `node scripts/sync-template-pins.mjs`. See usetheokit/theokit#424.')
  process.exit(1)
}

writeFileSync(TEMPLATE, updated, 'utf8')
console.log('Template pins updated:')
for (const c of changed) console.log(`  - ${c}`)
