#!/usr/bin/env node
/**
 * Guard against the `workspace:` publish leak (issue #115).
 *
 * `npm publish` (unlike `pnpm publish`) does NOT resolve the `workspace:` protocol, so a package published
 * with npm ships raw `workspace:^` in its dependencies and every external `npm install` fails with
 * `EUNSUPPORTEDPROTOCOL`. This script fetches the ACTUAL published `package.json` for each publishable
 * workspace package (at its current local version) from the registry and fails if any dependency field
 * still contains a `workspace:` specifier — catching the leak regardless of which tool published it.
 *
 * Usage:
 *   node scripts/verify-published-no-workspace.mjs            # check every publishable package @ its local version
 *   node scripts/verify-published-no-workspace.mjs theokit    # check one package @ its local version
 *
 * Run it AFTER publishing (or in CI post-publish). Exit 1 on any leak.
 * The correct publish command is `pnpm publish` (it resolves `workspace:` at pack time); never `npm publish`
 * for a workspace package.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Read every publishable (non-private) package manifest under packages/*. */
function publishablePackages() {
  const packagesDir = join(ROOT, 'packages')
  const out = []
  for (const entry of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    if (pkg.private === true || typeof pkg.name !== 'string') continue
    out.push({ name: pkg.name, version: pkg.version })
  }
  return out
}

/** Fetch the published manifest's dependency fields; returns null when the version is not on the registry. */
function fetchPublishedDeps(name, version) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- build-time release script; npm is the canonical registry client
    const raw = execFileSync('npm', ['view', `${name}@${version}`, ...DEP_FIELDS, '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return raw.trim() === '' ? {} : JSON.parse(raw)
  } catch {
    return null // not published (yet) — nothing to verify
  }
}

/** Collect `field.dep = workspace:...` leaks from a published manifest slice. */
function findLeaks(published) {
  const leaks = []
  // `npm view` returns the single field's object when only one field exists, else a keyed object.
  const fields = DEP_FIELDS.some((f) => f in published) ? published : { dependencies: published }
  for (const field of DEP_FIELDS) {
    const deps = fields[field]
    if (deps === undefined || deps === null) continue
    for (const [dep, range] of Object.entries(deps)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        leaks.push(`${field}.${dep} = ${range}`)
      }
    }
  }
  return leaks
}

const only = process.argv[2]
const targets = publishablePackages().filter((p) => only === undefined || p.name === only)

if (targets.length === 0) {
  console.error(only ? `No publishable package named ${only}` : 'No publishable packages found')
  process.exit(1)
}

let failed = false
for (const { name, version } of targets) {
  const published = fetchPublishedDeps(name, version)
  if (published === null) {
    console.log(`- ${name}@${version}: not on registry (skipped)`)
    continue
  }
  const leaks = findLeaks(published)
  if (leaks.length > 0) {
    failed = true
    console.error(
      `✗ ${name}@${version} leaked workspace: protocol into published deps (issue #115):`,
    )
    for (const leak of leaks) console.error(`    ${leak}`)
    console.error(
      `  → republish with 'pnpm publish' (it resolves workspace: at pack time), then deprecate this version.`,
    )
  } else {
    console.log(`✓ ${name}@${version}: no workspace: leak`)
  }
}

if (failed) {
  console.error(
    '\nworkspace: leak detected — see issue #115. NEVER use `npm publish` for a workspace package; use `pnpm publish`.',
  )
  process.exit(1)
}
console.log('\nAll published packages are free of the workspace: protocol.')
