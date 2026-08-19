#!/usr/bin/env node
/**
 * Release guard — a published tarball must not carry an unresolved `workspace:` range.
 *
 * ## The failure this exists to prevent
 *
 * `workspace:^` is a pnpm protocol, not a semver range. npm cannot install it. When a tarball ships
 * with one intact, every consumer's install fails on a package that looks perfectly normal in the
 * registry. This repository's CHANGELOG calls the last occurrence "the failure that made twelve
 * published versions uninstallable".
 *
 * `pnpm pack` substitutes the real version at pack time, so the happy path is already correct — this
 * guard is for the paths that skip it (a plain `npm publish`, a different pnpm major, a CI runner
 * that resolved a different binary). It costs one pack per publishable package.
 *
 * ## Why it lives here and not in an untracked directory
 *
 * `package.json` once declared 26 scripts under `scripts/`, and that directory was never in the
 * tree. On a fresh clone every one of them failed with "Cannot find module" — including this guard,
 * whose npm script and `prepublishOnly` hook both looked present and enforced nothing. A gate that
 * cannot run on a clean checkout is a gate in name only, so this file is committed.
 *
 * Usage: `node scripts/check-pack-no-workspace.mjs` (all publishable packages)
 *        `node scripts/check-pack-no-workspace.mjs <dir>` (one package — used by prepublishOnly)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Packages that declare `private: true` are never published, so they cannot leak. */
function publishablePackages() {
  const root = 'packages'
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name))
    .filter((dir) => {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        return pkg.private !== true
      } catch {
        return false
      }
    })
}

/** Pack `dir` into a temp directory and return the packed manifest. */
function packedManifest(dir) {
  const out = mkdtempSync(join(tmpdir(), 'theokit-pack-'))
  try {
    // `pnpm` from the toolchain; an absolute path would break on every machine whose pnpm lives
    // elsewhere.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const tarball = readdirSync(out).find((f) => f.endsWith('.tgz'))
    if (tarball === undefined) throw new Error(`pnpm pack produced no tarball in ${dir}`)
    // `tar` from the system toolchain, reading a tarball this process just created in its own
    // temp directory.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const json = execFileSync('tar', ['-xzOf', join(out, tarball), 'package/package.json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    })
    return JSON.parse(json)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

function unresolvedRanges(manifest) {
  const found = []
  for (const section of DEP_SECTIONS) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        found.push(`${section}.${name} = ${range}`)
      }
    }
  }
  return found
}

/**
 * Refuses a publish driven by npm when the on-disk manifest still holds a `workspace:` range.
 *
 * The gate above packs through `pnpm`, which SUBSTITUTES the range — so it reports a clean tarball
 * even when the publish about to happen will ship the raw protocol. That blind spot is not
 * hypothetical: `theokit@0.48.4` passed this check and shipped `"@theokit/agents": "workspace:^"`,
 * uninstallable for every consumer, because it was published with `npm publish` rather than
 * `pnpm publish`.
 *
 * npm never substitutes the protocol, so the only safe answer under npm is to stop.
 */
function refuseNpmPublishWithWorkspaceRanges(dir) {
  const agent = process.env.npm_config_user_agent ?? ''
  const drivenByPnpm = agent.includes('pnpm')
  if (drivenByPnpm) return false

  const onDisk = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const leaks = unresolvedRanges(onDisk)
  if (leaks.length === 0) return false

  console.error(
    `✗ ${onDisk.name}@${onDisk.version}: publishing through npm would ship these verbatim:`,
  )
  for (const leak of leaks) console.error(`    ${leak}`)
  console.error(
    '\nOnly pnpm substitutes `workspace:` ranges. `npm publish` ships them as written, and npm\n' +
      'cannot install the result — this is how theokit@0.48.4 reached the registry broken.\n' +
      'Publish with `pnpm publish` instead.',
  )
  return true
}

const argDir = process.argv[2]
const targets = argDir === undefined ? publishablePackages() : [argDir]

// Non-vacuity floor. Packing nothing reports no leak and exits 0 — the shape of gate this
// repository has repeatedly found certifying by absence of execution.
if (targets.length === 0) {
  console.error('check-pack-no-workspace: no publishable package found — nothing was inspected')
  process.exit(1)
}
for (const dir of targets) {
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a directory')
  } catch {
    console.error(`check-pack-no-workspace: ${dir} is not a directory`)
    process.exit(1)
  }
}

let failed = false
for (const dir of targets) {
  if (refuseNpmPublishWithWorkspaceRanges(dir)) {
    failed = true
    continue
  }
  const manifest = packedManifest(dir)
  const leaks = unresolvedRanges(manifest)
  if (leaks.length > 0) {
    failed = true
    console.error(`✗ ${manifest.name}@${manifest.version} would publish unresolved ranges:`)
    for (const leak of leaks) console.error(`    ${leak}`)
  } else {
    console.log(`✓ ${manifest.name}@${manifest.version}`)
  }
}

if (failed) {
  console.error(
    '\nA `workspace:` range is a pnpm protocol npm cannot install. Publishing this would make the\n' +
      'package uninstallable for every consumer. Pack through pnpm so the range is substituted.',
  )
  process.exit(1)
}
console.log(`\nchecked ${targets.length} package(s): no unresolved workspace range`)
