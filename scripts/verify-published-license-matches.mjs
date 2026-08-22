#!/usr/bin/env node
/**
 * Compliance REPORT — does the registry serve the licence this repository declares?
 *
 * Deliberately a report and not a release gate, and the reason is worth stating because the
 * opposite is the obvious choice: the mismatch lives on an ALREADY PUBLISHED version, which is
 * immutable, so the only way to correct it is to publish a new one. A gate in the release chain
 * would therefore block the single action that fixes what it is complaining about. Run it, read it,
 * and let the next release clear it.
 *
 * ## The failure this exists to prevent
 *
 * `@theokit/http@1.1.0` and `@theokit/presenter@0.7.0` are `MIT` on npm and `Apache-2.0` here — the
 * SAME version numbers, two different licences depending on where you got the code
 * (usetheokit/theokit#422). Nothing detected it, because the licence gate this repository already
 * has (`check-licenses.mjs`) audits what we CONSUME, not what we PUBLISH.
 *
 * A published version is immutable, so this cannot be fixed by editing a file: the registry keeps
 * serving MIT for 1.1.0 forever. What a guard buys is that the NEXT one is caught before it ships,
 * and that the existing mismatch stops being invisible.
 *
 * ## What it proves, and what it does not
 *
 * It compares the licence in each package manifest against the licence the registry serves for that
 * package's LATEST published version. It does not audit the tarball's `LICENSE` file, and it cannot
 * repair an already-published mismatch — only report it.
 *
 * A package the registry has never seen is SKIPPED: there is no published licence to disagree with.
 *
 * Offline or with an unreachable registry it FAILS rather than passing, for the reason its sibling
 * `verify-version-not-published.mjs` gives: "I could not check" and "there is no mismatch" are
 * different facts, and only one of them is safe to release on.
 *
 * Usage: `node scripts/verify-published-license-matches.mjs`
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
        if (typeof pkg.name !== 'string') return []
        return [{ dir, name: pkg.name, declared: pkg.license, version: pkg.version }]
      } catch {
        return []
      }
    })
}

/** The licence + version the registry serves for `latest`, or a state that is not a licence. */
function publishedLicenceOf(name) {
  try {
    // `npm` from the toolchain, asked a read-only question about the public registry.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const out = execFileSync('npm', ['view', name, 'license', 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    return { state: 'published', licence: parsed.license, version: parsed.version }
  } catch (err) {
    const stderr = String(err?.stderr ?? '')
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) return { state: 'absent' }
    return { state: 'unknown', detail: stderr.split('\n').find((l) => l.trim().length > 0) }
  }
}

const problems = []
for (const pkg of publishablePackages()) {
  const published = publishedLicenceOf(pkg.name)

  if (published.state === 'absent') continue
  if (published.state === 'unknown') {
    problems.push(`${pkg.name}: could not read the registry — ${published.detail ?? 'no detail'}`)
    continue
  }
  if (typeof pkg.declared !== 'string' || pkg.declared.length === 0) {
    // A tarball with no licence is "all rights reserved" to whoever installs it, which is the
    // opposite of shipping an open framework — the same reasoning `check-licenses.mjs` applies to
    // what we consume.
    problems.push(`${pkg.name}: this repository declares no \`license\` field`)
    continue
  }
  if (published.licence !== pkg.declared) {
    problems.push(
      `${pkg.name}: repository declares ${pkg.declared}, registry serves ${String(published.licence)} ` +
        `for ${String(published.version)} (a published version is immutable — the fix is a republish)`,
    )
  }
}

if (problems.length > 0) {
  console.error('Published licence does not match this repository:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nSee usetheokit/theokit#422.')
  process.exit(1)
}
console.log('Every published package serves the licence this repository declares.')
