#!/usr/bin/env node
/**
 * Refuse a commit range that changes a publishable package's source and names no changeset for it.
 *
 * ## Why this exists
 *
 * Measured 2026-09-22 (B-252): `develop` stood 65 commits ahead of `main` with changes to
 * `packages/theo/src` and `packages/http/src`, and two changesets, both declaring `theokit`. Four
 * `fix(http)` commits — one of them the PBKDF2 salt fix — would have merged, published nothing, and
 * left `@theokit/http` at the version a consumer already had. The version number still matches, the
 * release reports success, and the only symptom is that the bug is still there.
 *
 * `changeset status --since=<base>` does not catch it. Measured with the changeset moved aside: it
 * exits 0 and simply omits the package, because it reports what WILL be bumped rather than what
 * SHOULD have been.
 *
 * ## What it does NOT claim
 *
 * That a declared changeset is correct — the bump level and the prose are a human's call. This
 * checks coverage only: a package whose source moved is named by something.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const base = process.argv[2] ?? 'origin/main'

/** `git` failures are the check failing to run, never the check passing. */
function git(args) {
  try {
    // The argv is an array, so no shell parses it, and the one non-literal argument is a ref put
    // through `rev-parse --verify` before any other call uses it. The directive sits on the line
    // immediately above the call on purpose: `-next-line` annotates whatever follows it, so a
    // comment placed in between takes the annotation and the call goes unguarded.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  } catch (err) {
    console.error(`check-changeset-coverage: \`git ${args.join(' ')}\` failed — ${err.message}`)
    console.error('  The range could not be read, so nothing was verified. This is not a pass.')
    process.exit(2)
  }
}

git(['rev-parse', '--verify', `${base}^{commit}`])

const changed = git(['diff', '--name-only', `${base}...HEAD`])
  .split('\n')
  .filter(Boolean)

/** A package directory whose `src/` moved. Tests, docs and config changes publish nothing. */
const touched = new Set()
for (const file of changed) {
  const m = /^packages\/([^/]+)\/src\//.exec(file)
  if (m) touched.add(m[1])
}

const needing = new Map()
for (const dir of touched) {
  const manifest = join(ROOT, 'packages', dir, 'package.json')
  if (!existsSync(manifest)) {
    console.error(
      `check-changeset-coverage: packages/${dir}/src changed and ${manifest} is absent.`,
    )
    process.exit(2)
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  // A private package publishes nothing, so a changeset would name something npm never sees.
  if (pkg.private === true) continue
  needing.set(pkg.name, dir)
}

/**
 * Every package any changeset names, read from the working tree rather than from the range: a
 * changeset added in an earlier commit of the same range still covers the change.
 */
const declared = new Set()
const dir = join(ROOT, '.changeset')
for (const entry of existsSync(dir) ? readdirSync(dir) : []) {
  if (!entry.endsWith('.md') || entry === 'README.md') continue
  const text = readFileSync(join(dir, entry), 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (front === null) {
    // A changeset the tool cannot parse is not a changeset that covers anything, and saying so
    // beats treating it as coverage.
    console.error(`check-changeset-coverage: .changeset/${entry} has no frontmatter block.`)
    process.exit(2)
  }
  for (const line of front[1].split('\n')) {
    const named = /^\s*["']([^"']+)["']\s*:/.exec(line)
    if (named) declared.add(named[1])
  }
}

const uncovered = [...needing].filter(([name]) => !declared.has(name))
if (uncovered.length === 0) {
  const n = needing.size
  console.log(
    `check-changeset-coverage: ${String(n)} publishable package(s) changed since ${base}, all declared.`,
  )
  process.exit(0)
}

console.error(
  `check-changeset-coverage: ${String(uncovered.length)} publishable package(s) changed`,
)
console.error(`  since ${base} and no changeset names them:\n`)
for (const [name, d] of uncovered) {
  console.error(`  ${name}   (packages/${d}/src)`)
}
console.error(
  '\nWithout one, merging publishes nothing for these and a consumer keeps the old code',
)
console.error('while the version number still matches. Add one with `pnpm changeset`.')
process.exit(1)
