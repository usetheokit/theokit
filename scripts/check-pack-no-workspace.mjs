#!/usr/bin/env node
/**
 * theokit#153 — refuse a `workspace:` leak BEFORE it becomes public.
 *
 * ## What this repo already had, and why it was not enough
 *
 * `verify-published-no-workspace.mjs` fetches the manifest that was ALREADY published and fails if it
 * still carries `workspace:`. That is the right assertion at the wrong moment: a published version
 * cannot be corrected, only deprecated. `theokit` 0.19.0–0.30.0 are the proof — twelve versions on
 * npm whose every `npm install` fails with `EUNSUPPORTEDPROTOCOL`, fixed in the code since 0.31.0 and
 * permanently broken as artifacts. It is also wired to nothing: an npm script nobody's CI invokes.
 *
 * The issue puts it exactly: "the fix exists, the guard does not". This is the guard.
 *
 * ## Why it inspects the TARBALL and not `package.json`
 *
 * On disk, a correct workspace manifest says `"@theokit/http": "workspace:^"`. That is not a defect —
 * it is how the monorepo is meant to be written, and `pnpm pack` rewrites it to a real range while
 * packing. So a check that reads each package manifest on disk would fail the correct setup and teach
 * everyone to bypass it.
 *
 * What ships is the tarball. `npm publish` (unlike `pnpm publish`) does NOT resolve the protocol, so
 * the leak appears exactly there — which makes the packed manifest the only artifact that answers the
 * real question, and makes this check indifferent to which tool ran.
 *
 * ## Honest limits
 *
 * It packs with the repo's own package manager. It therefore proves "the tarball THIS toolchain
 * produces is clean", not "no toolchain can produce a dirty one". A publish run by `npm publish` on a
 * developer's machine still bypasses it — that path is closed by the release process, not by this
 * script. Nothing here can catch a publish that never ran CI.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Every non-private package under the packages directory — the set that can actually reach the registry. */
function publishablePackages() {
  const out = []
  for (const entry of readdirSync(join(ROOT, 'packages'))) {
    const manifestPath = join(ROOT, 'packages', entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    if (pkg.private === true || typeof pkg.name !== 'string') continue
    out.push({ name: pkg.name, dir: join(ROOT, 'packages', entry) })
  }
  return out
}

/** Read `package.json` out of the packed tarball, without unpacking the whole thing. */
function manifestInTarball(tarball) {
  // build-time CI script; `tar` is the canonical archive reader and the argv is fully controlled
  // (no shell, no user input) — same exemption the sibling verify-published script takes for `npm`.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  const listed = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' })
    .split('\n')
    .filter((p) => p.endsWith('/package.json'))
    // The manifest sits at the archive root (`package/package.json`); a nested one belongs to a
    // bundled fixture and would answer a different question.
    .sort((a, b) => a.split('/').length - b.split('/').length)
  if (listed.length === 0) throw new Error(`no package.json inside ${tarball}`)
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- same as above
  return JSON.parse(execFileSync('tar', ['-xzOf', tarball, listed[0]], { encoding: 'utf-8' }))
}

/** Every `field.dep` in `manifest` whose specifier still carries the workspace protocol. */
function workspaceLeaks(manifest) {
  const leaks = []
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        leaks.push(`${field}.${dep} = "${range}"`)
      }
    }
  }
  return leaks
}

const packages = publishablePackages()
// Anti-vacuity floor: with zero packages every loop below passes and the gate reports green while
// measuring nothing — the failure mode this whole file exists to prevent, one level up.
if (packages.length === 0) {
  console.error('FAIL: no publishable package found under packages/ — this gate measured nothing.')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'pack-no-workspace-'))
let failed = 0
try {
  for (const { name, dir } of packages) {
    let manifest
    try {
      // `pnpm` is this repo's package manager and the only tool that resolves `workspace:` at pack
      // time — which is precisely what this gate needs to observe.
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
      const out = execFileSync('pnpm', ['pack', '--pack-destination', work], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const tarball = out.trim().split('\n').filter(Boolean).pop()
      manifest = manifestInTarball(tarball.startsWith('/') ? tarball : join(work, tarball))
    } catch (err) {
      // Never swallow: a pack that cannot run is an UNKNOWN, and an unknown must not read as clean.
      console.error(`FAIL ${name}: could not pack — ${err.message}`)
      failed += 1
      continue
    }
    const leaks = workspaceLeaks(manifest)
    if (leaks.length > 0) {
      console.error(`FAIL ${name}: the tarball still carries the workspace protocol:`)
      for (const leak of leaks) console.error(`        ${leak}`)
      failed += 1
    } else {
      console.log(`ok   ${name}`)
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failed > 0) {
  console.error(
    `\n${failed} package(s) would publish an uninstallable manifest.\n` +
      'Every `npm install` of such a version fails with EUNSUPPORTEDPROTOCOL, and a published\n' +
      'version cannot be fixed — only deprecated (theokit#153, theokit 0.19.0-0.30.0).\n' +
      'Publish with `pnpm publish`, never `npm publish`, for a workspace package.',
  )
  process.exit(1)
}
console.log(
  `\n${packages.length} package(s) pack clean — no workspace protocol reaches the registry.`,
)
