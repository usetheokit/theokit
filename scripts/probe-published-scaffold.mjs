#!/usr/bin/env node
/**
 * Scaffold a consumer from the REGISTRY, outside this workspace, and report what it resolved.
 *
 * ## Why this exists beside `try:scaffold`, rather than replacing it
 *
 * `pnpm try:scaffold` creates `my-test` and then runs `link-scaffold-to-workspace.ts`, which points
 * it at this working tree. That is deliberate and it is documented: usetheokit/theokit#420 found
 * that "every local verification run through that script had been measuring the published package",
 * and worse, that it linked only SOME packages — pairing a local agent runtime with a published
 * framework, a combination that fails in ways neither version exhibits alone.
 *
 * So `my-test` answers *does the working tree integrate*. It cannot answer *does what a consumer
 * installs work*, and it is not supposed to: `pnpm-workspace.yaml` declares it a member, so the root
 * install resolves its dependencies and it can never hold a version the monorepo does not.
 *
 * `rules/cycle-acceptance.md` names the distinction and says which one acceptance claims: "a working
 * tree carries uncommitted edits, local config, and a dev server that behaves nothing like the built
 * output". This script is the other half — the same scaffold with nothing linked.
 *
 * ## What it refuses to do
 *
 * It never writes inside this repository, and it never uses pnpm. Both are the same guard: a `pnpm`
 * install run from a directory inside the workspace consults `pnpm-workspace.yaml` and links, which
 * is the exact thing being avoided. The scaffold goes to `mkdtemp` and `npm` installs it.
 *
 * ## Usage
 *
 *   node scripts/probe-published-scaffold.mjs                     report resolved versions
 *   node scripts/probe-published-scaffold.mjs --expect-ui 1.12.1  and fail if it is not that
 *   node scripts/probe-published-scaffold.mjs --keep               leave the scaffold on disk
 *
 * Exit 0  the scaffold installed and every `--expect-*` held
 * Exit 1  an expectation did not hold — the resolved version is printed beside the expected one
 * Exit 2  the probe could not measure (scaffold or install failed). NOT a pass: "we could not check"
 *         and "we checked and it is clean" are different facts.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The version on DISK, never the range in the manifest — the range is what was asked for. */
function resolvedVersion(root, pkg) {
  const manifest = join(root, 'node_modules', pkg, 'package.json')
  if (!existsSync(manifest)) return null
  return JSON.parse(readFileSync(manifest, 'utf8')).version
}

const dir = mkdtempSync(join(tmpdir(), 'theo-published-scaffold-'))
const app = join(dir, 'probe-app')
let failed = false

try {
  // `npm create` rather than the local CLI: the point is the artifact a consumer reaches for.
  process.stdout.write(`probe-published-scaffold: ${app}\n`)
  run('npm', ['create', 'theokit@latest', '--', 'probe-app', '--yes'], dir)
  if (!existsSync(app)) {
    process.stderr.write('  the scaffold created no directory\n')
    process.exit(2)
  }
  run('npm', ['install', '--no-audit', '--no-fund'], app)

  const declared = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).dependencies ?? {}
  for (const pkg of ['theokit', '@theokit/ui']) {
    const got = resolvedVersion(app, pkg)
    process.stdout.write(
      `  ${pkg}\n    asked for  ${declared[pkg] ?? '(not declared)'}\n    resolved   ${got ?? 'ABSENT'}\n`,
    )
  }

  // An expectation is checked against the resolved version, never against the range.
  for (const [flag, pkg] of [
    ['expect-ui', '@theokit/ui'],
    ['expect-theokit', 'theokit'],
  ]) {
    const want = arg(flag)
    if (!want) continue
    const got = resolvedVersion(app, pkg)
    if (got !== want) {
      process.stderr.write(`  FAIL ${pkg}: expected ${want}, resolved ${got ?? 'ABSENT'}\n`)
      failed = true
    }
  }

  if (hasFlag('keep')) {
    process.stdout.write(`\n  kept at ${app}\n  build and probe it with:\n`)
    process.stdout.write(`    (cd ${app} && npm run build && npm start &) \\\n`)
    process.stdout.write(
      `      && node ${join(REPO, 'scripts/probe-hydration.mjs')} --url http://127.0.0.1:3000\n`,
    )
  }
} catch (error) {
  process.stderr.write(`  could not measure: ${error.message}\n`)
  if (error.stderr) process.stderr.write(`${error.stderr}\n`)
  process.exit(2)
} finally {
  if (!hasFlag('keep')) rmSync(dir, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
