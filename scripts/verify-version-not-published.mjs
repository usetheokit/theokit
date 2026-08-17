#!/usr/bin/env node
/**
 * Release guard — refuse to cut a version the registry already has.
 *
 * ## The failure this exists to prevent
 *
 * In M67 `pnpm version-packages` computed `@theokit/agents@7.5.0`. npm had had that version for two
 * days, with different content: the release commit had landed on `main` and `workspace` never got
 * the back-merge, so the already-consumed changesets were still on disk and the bump was recomputed.
 *
 * npm cannot be relied on to stop it. `changeset publish` SKIPS a version it finds in the registry —
 * the release reports success having published nothing, while the local CHANGELOG and the git tag
 * are left asserting a number whose content never went out. The lie outlives the release.
 *
 * ## What it does and does not prove
 *
 * It proves the versions in the working tree are not yet on the registry. It does NOT prove the
 * publish will succeed — credentials, network and registry policy are separate questions. A guard
 * that claimed more than it measures is the failure mode this repository keeps finding.
 *
 * Offline or with an unreachable registry it FAILS rather than passing: "I could not check" and
 * "there is no collision" are different facts, and only one of them is safe to publish on.
 *
 * Usage: `node scripts/verify-version-not-published.mjs`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function publishablePackages() {
  return readdirSync('packages', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join('packages', e.name))
    .flatMap((dir) => {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (pkg.private === true) return []
        if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') return []
        return [{ dir, name: pkg.name, version: pkg.version }]
      } catch {
        return []
      }
    })
}

/**
 * `npm view <pkg>@<version> version` prints the version when it exists and exits non-zero with
 * E404 when it does not. Any other failure is reported as unknown rather than treated as absent.
 */
function registryState({ name, version }) {
  try {
    // `npm` from the toolchain, asked a read-only question about the public registry.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.trim().length > 0 ? 'published' : 'absent'
  } catch (err) {
    const stderr = String(err?.stderr ?? '')
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) return 'absent'
    return `unknown: ${stderr.split('\n').find((l) => l.trim().length > 0) ?? 'no detail'}`
  }
}

const packages = publishablePackages()

// Non-vacuity floor: checking nothing and reporting green is the defect, not the check.
if (packages.length === 0) {
  console.error('verify-version-not-published: found no publishable package — nothing was checked')
  process.exit(1)
}

let collisions = 0
let unknown = 0
for (const pkg of packages) {
  const state = registryState(pkg)
  if (state === 'published') {
    collisions++
    console.error(`✗ ${pkg.name}@${pkg.version} is ALREADY on the registry`)
  } else if (state === 'absent') {
    console.log(`✓ ${pkg.name}@${pkg.version} is not published yet`)
  } else {
    unknown++
    console.error(`? ${pkg.name}@${pkg.version} could not be checked — ${state}`)
  }
}

if (collisions > 0) {
  console.error(
    `\n${collisions} version(s) already exist. \`changeset publish\` would SKIP them and still exit 0,\n` +
      'leaving a CHANGELOG entry and a tag for content that never shipped. Back-merge `main` into\n' +
      '`workspace` so the consumed changesets are gone, then recompute the bump.',
  )
  process.exit(1)
}
if (unknown > 0) {
  console.error(
    `\n${unknown} version(s) could not be checked against the registry. Not knowing is not the same\n` +
      'as not colliding, and only one of the two is safe to publish on.',
  )
  process.exit(1)
}
console.log(`\nchecked ${packages.length} package(s): no version collision`)
