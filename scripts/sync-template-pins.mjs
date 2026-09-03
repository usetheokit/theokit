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
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/**
 * Prerelease mode changes what "the version this release publishes" may mean here, and the docblock
 * above predates it.
 *
 * A scaffolded app is a NEW CONSUMER, and a new consumer belongs on the stable channel. Syncing the
 * template during a prerelease cut pins `create-theokit` at `^0.65.0-next.0`, so every app anyone
 * scaffolds arrives silently on the `next` channel — the opposite of what a default is for, and
 * invisible until something on that channel breaks.
 *
 * It also deadlocks the release outright, which is how this was found (usetheokit/theokit#618).
 * `tests/integration/pnpm-11-compat.test.ts` scaffolds from this template and runs `pnpm install`;
 * the pinned prerelease is not on the registry yet, so the install 404s and the test fails — while
 * the publish that would create that version is blocked by that same failing test.
 *
 * Under prerelease mode the template therefore keeps the pin it has, which points at the last
 * stable line. The original invariant is untouched for stable cuts, which is what it was reasoned
 * about.
 */
function inPrereleaseMode() {
  const pre = '.changeset/pre.json'
  if (!existsSync(pre)) return false
  try {
    return JSON.parse(readFileSync(pre, 'utf8')).mode === 'pre'
  } catch {
    // A pre.json that exists and does not parse is not "we are on stable" — resolving it that way
    // would resolve an unknown in the direction that rewrites the template.
    throw new Error('.changeset/pre.json exists but is not valid JSON')
  }
}

/**
 * Does `^range` admit `version`? Caret semantics, enough of them for this file's question.
 *
 * No semver dependency: none is resolvable here, and the rule is "the leading non-zero component
 * must match" — `^1.2.3` admits `1.x`, `^0.2.3` admits `0.2.x`. A range this cannot read returns
 * `undefined`, never `false`: a wrong "does not admit" would fail a release on a shape nobody
 * taught it.
 */
export function caretAdmits(range, version) {
  const r = /^\^(\d+)\.(\d+)\.(\d+)/u.exec(range)
  const v = /^(\d+)\.(\d+)\.(\d+)/u.exec(version)
  if (r === null || v === null) return undefined
  const [rMajor, rMinor] = [Number(r[1]), Number(r[2])]
  const [vMajor, vMinor] = [Number(v[1]), Number(v[2])]
  if (rMajor !== vMajor) return false
  // A caret on a 0.x line pins the MINOR, so it admits only its own minor.
  if (rMajor === 0) return rMinor === vMinor
  return vMinor >= rMinor
}

/** The version npm serves on `latest`, or `undefined` when the registry cannot be read. */
function publishedLatest(name) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const out = execFileSync('npm', ['view', name, 'dist-tags.latest'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || undefined
  } catch {
    // Offline, private, rate-limited — all UNKNOWN. Reporting a pin as wrong because the registry
    // did not answer would fail a release on a network blip.
    return undefined
  }
}

/** Template pins that exclude the published stable, and the ones that could not be checked. */
function auditPrereleasePins() {
  const template = readFileSync(TEMPLATE, 'utf8')
  const stale = []
  const unknown = []

  for (const name of workspaceVersions().keys()) {
    const line = new RegExp(`"${name.replaceAll('/', '\\/')}"\\s*:\\s*"([^"]+)"`, 'u')
    const match = line.exec(template)
    if (match === null) continue

    const latest = publishedLatest(name)
    if (latest === undefined) {
      unknown.push(name)
      continue
    }

    const admits = caretAdmits(match[1], latest)
    if (admits === false) stale.push(`${name}: template pins ${match[1]}, npm latest is ${latest}`)
    else if (admits === undefined) unknown.push(`${name} (range ${match[1]} is not a plain caret)`)
  }

  return { stale, unknown }
}

/**
 * Prerelease mode: abstain from rewriting, but VERIFY the premise the abstention rests on.
 *
 * That premise — "the pin it has points at the last stable line" — was asserted and never checked,
 * and it fails as soon as one workspace package publishes STABLE releases while another is
 * mid-prerelease. It did: `@theokit/agents` reached 12.1.0 on `latest` while the template still
 * pinned `^10.1.0`, so every generated app ran two majors behind — missing, among other things,
 * the 11.0.0 fix that stopped the server's raw error text reaching the browser. The same defect as
 * usetheokit/theokit#424, arriving through the one door this script left open.
 */
function reportPrereleasePins() {
  const { stale, unknown } = auditPrereleasePins()

  if (unknown.length > 0) console.log(`Prerelease mode — could not verify: ${unknown.join(', ')}`)

  if (stale.length > 0) {
    console.error('\nTemplate pins exclude the published stable release:\n')
    for (const entry of stale) console.error(`  - ${entry}`)
    console.error('\nA scaffolded app would install an older line than `latest`. Bump the pin in')
    console.error(`${TEMPLATE}. See usetheokit/theokit#424.`)
    return 1
  }

  console.log('Prerelease mode — pins left alone, and each admits the published stable release.')
  return 0
}

/**
 * Everything with a side effect, behind a function so importing this file does not run it.
 *
 * `caretAdmits` is pure and carries the rule worth unit-testing; without this guard the import
 * alone reached `process.exit` and the suite died before its first assertion. Same idiom, for the
 * same reason, as `preview-packages.mjs`.
 */
function main() {
  if (inPrereleaseMode()) {
    process.exit(reportPrereleasePins())
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
}

// Only when run as a script — see main()'s docblock.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
