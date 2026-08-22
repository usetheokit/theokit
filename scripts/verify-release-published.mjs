#!/usr/bin/env node
/**
 * Release guard — refuse to report success for a release that published nothing.
 *
 * ## The failure this exists to prevent
 *
 * On 2026-08-20 the release pipeline ran green and nothing reached npm: both packages answered
 * `E404 Not Found - PUT` because the credential was gone (usetheokit/theokit#366). Worse than the
 * failure was what it exposed — the PREVIOUS run was also green, with the same missing credential,
 * because every local version already existed on the registry. There was nothing to publish, so
 * nothing failed.
 *
 * "Nothing to publish" and "published" produced the same visible result, and that is what hid an
 * absent secret for at least one release. A publish pipeline that reports success when it publishes
 * nothing is indistinguishable from one that published — until the day it matters.
 *
 * ## The mirror of its sibling, with a different baseline — and the baseline is the point
 *
 * `verify-version-not-published.mjs` runs during `version-packages`, when the bumped version
 * differs from `origin/main`, so "what this release publishes" is exactly that difference.
 *
 * By the time THIS runs, the version commit has merged: the workflow is on `main`, so the repo and
 * the baseline are the same commit and that difference is empty. Reusing it would make this guard
 * a no-op precisely when it matters — I wrote it that way first and it reported "nothing to verify"
 * against a repository at `0.49.0` and a registry at `0.48.14`.
 *
 * The question that survives the merge is simpler and is the actual post-release invariant: **is
 * every version this repository declares on the registry?** True after a successful release, false
 * after one that published nothing. A package no changeset touched is already published at its
 * current version, so it passes without being special-cased.
 *
 * ## What it proves, and what it does not
 *
 * It proves the versions this release was supposed to publish are ON the registry. It does not
 * prove the tarball's contents, the provenance attestation, or that the right account published —
 * a guard that claimed more than it measures is the failure mode this repository keeps finding.
 *
 * An unreachable registry FAILS rather than passing: "I could not check" and "it published" are
 * different facts, and only one of them is safe to report as a release.
 *
 * Usage: `node scripts/verify-release-published.mjs`
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
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

function registryState({ name, version }) {
  try {
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

// Non-vacuity floor, borrowed from the sibling: checking nothing and reporting green is the defect,
// not the check.
if (packages.length === 0) {
  console.error('verify-release-published: found no publishable package — nothing was checked')
  process.exit(1)
}

let missing = 0
let unknown = 0
for (const pkg of packages) {
  const state = registryState(pkg)
  if (state === 'published') {
    console.log(`✓ ${pkg.name}@${pkg.version} is on the registry`)
  } else if (state === 'absent') {
    missing++
    console.error(`✗ ${pkg.name}@${pkg.version} was NOT published`)
  } else {
    unknown++
    console.error(`? ${pkg.name}@${pkg.version} could not be checked — ${state}`)
  }
}

if (missing > 0 || unknown > 0) {
  console.error(
    `\nThis release wrote a CHANGELOG entry and a tag for ${String(missing + unknown)} package(s) ` +
      'that are not on the registry. A green pipeline that published nothing is what\n' +
      'usetheokit/theokit#366 reports; the credential and the trusted-publisher configuration are\n' +
      'the two things worth checking first.',
  )
  process.exit(1)
}
