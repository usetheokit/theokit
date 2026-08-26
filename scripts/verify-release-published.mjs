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
    // `--prefer-online` because `npm view` will otherwise answer from the local metadata
    // cache, which in a release job was populated moments before the publish.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version', '--prefer-online'], {
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

/**
 * Does the tag for this release exist locally?
 *
 * `git tag -l <name>` prints the tag when it exists and nothing when it does not, exiting 0 either
 * way — so the answer is on stdout, not in the status. Checked LOCALLY on purpose: changesets
 * creates the tags before pushing them, so a local hit with a failed push is precisely the state
 * this distinguishes, and asking the remote would report the same "absent" for both.
 */
function tagState({ name, version }) {
  const tag = `${name}@${version}`
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const out = execFileSync('git', ['tag', '-l', tag], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.trim().length > 0 ? 'tagged' : 'absent'
  } catch (err) {
    // A git that cannot answer is NOT evidence of an absent tag. Saying so keeps this from
    // reporting a failure it did not observe — the defect the whole script exists to prevent.
    return `unknown: ${String(err?.stderr ?? err).split('\n')[0]}`
  }
}

const packages = publishablePackages()

// Non-vacuity floor, borrowed from the sibling: checking nothing and reporting green is the defect,
// not the check.
if (packages.length === 0) {
  console.error('verify-release-published: found no publishable package — nothing was checked')
  process.exit(1)
}

/**
 * npmjs is eventually consistent: a publish that has already succeeded answers E404 on the read
 * path for a few seconds, and `npm view` reports that identically to a version nobody published.
 *
 * Run 32771822392 (2026-08-24) is the demonstration. `changeset publish` wrote five packages at
 * 20:06:49; this guard read at 20:06:52 and failed the release naming all five as unpublished. All
 * five were on the registry. The single package it passed — `@theokit/tauri@0.1.2` — was the only
 * one NOT published in that run, so it had propagated long before.
 *
 * So `absent` is retried before it is believed. `unknown` is not: an unreachable registry is an
 * infrastructure fault, and the honest response is to say so now rather than after half a minute
 * of waiting for a network that is down.
 *
 * The budget is bounded and the delays are overridable so the suite can exercise the retry without
 * sleeping through it. A guard that retried forever would hang a release; one that never retried
 * fails a good one.
 */
const RETRY_DELAYS_MS = (process.env.THEO_RELEASE_VERIFY_DELAYS_MS ?? '2000,4000,8000,16000')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let unknown = 0
let pending = []
for (const pkg of packages) {
  const state = registryState(pkg)
  if (state === 'published') {
    console.log(`✓ ${pkg.name}@${pkg.version} is on the registry`)
  } else if (state === 'absent') {
    pending.push(pkg)
  } else {
    unknown++
    console.error(`? ${pkg.name}@${pkg.version} could not be checked — ${state}`)
  }
}

for (const delay of RETRY_DELAYS_MS) {
  if (pending.length === 0) break
  console.log(
    `… ${String(pending.length)} version(s) not visible yet; the registry is eventually ` +
      `consistent, so waiting ${String(delay)}ms and re-reading before calling them unpublished`,
  )
  await sleep(delay)
  const stillPending = []
  for (const pkg of pending) {
    if (registryState(pkg) === 'published') {
      console.log(`✓ ${pkg.name}@${pkg.version} is on the registry (after a retry)`)
    } else {
      stillPending.push(pkg)
    }
  }
  pending = stillPending
}

const missing = pending.length
for (const pkg of pending) {
  console.error(`✗ ${pkg.name}@${pkg.version} was NOT published`)
}

// The second axis. `changesets publish` and the tag push live in one step, so a push that fails
// after a successful publish leaves the run red and indistinguishable from one that published
// nothing — which is the failure the paragraph below reports, and the wrong thing to conclude. An
// operator who concludes it re-cuts a release against a registry that already has the version
// (usetheokit/theokit#504).
const untagged = []
const untagStateUnknown = []
for (const pkg of packages) {
  const state = tagState(pkg)
  if (state === 'tagged') continue
  // `unknown` is NOT `absent`, and the first draft of this block treated them the same — failing a
  // run because git could not answer, which is reporting a state nobody observed. It is the exact
  // defect this script exists to prevent, written into the script itself.
  if (state.startsWith('unknown')) untagStateUnknown.push({ ...pkg, state })
  else untagged.push({ ...pkg, state })
}

for (const pkg of untagStateUnknown) {
  console.warn(`⚠ ${pkg.name}@${pkg.version}: could not read the tag — ${pkg.state}`)
}

if (untagged.length > 0 && missing === 0 && unknown === 0) {
  console.error('')
  for (const pkg of untagged) {
    console.error(`✗ ${pkg.name}@${pkg.version} WAS published, and its tag is ${pkg.state}`)
  }
  console.error(
    `\nThe publish succeeded and the tagging did not — these versions are on the registry with no\n` +
      'tag pointing at the commit they came from. This is NOT a failed release: do not re-cut it.\n' +
      'Create the tags against the commit this run published from and push them:\n' +
      untagged
        .map((p) => `    git tag -a "${p.name}@${p.version}" <sha> -m "${p.name}@${p.version}"`)
        .join('\n') +
      '\n\nWithout them `git describe` cannot name the release and check-changelog-current.mjs\n' +
      'compares against a tag that is not there.',
  )
  process.exit(1)
}

if (missing > 0 || unknown > 0) {
  console.error(
    `\nThis release wrote a CHANGELOG entry for ${String(missing + unknown)} package(s) ` +
      'that are not on the registry. A green pipeline that published nothing is what\n' +
      'usetheokit/theokit#366 reports; the credential and the trusted-publisher configuration are\n' +
      'the two things worth checking first.',
  )
  process.exit(1)
}
