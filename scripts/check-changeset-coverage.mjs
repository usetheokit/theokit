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
 *
 * ## A changeset no release publishes (B-658)
 *
 * Measured 2026-10-30 at `origin/main` `e155964`: `.changeset/theoclaw-pinned-deps.md` named only the
 * private `theoclaw` app, so the Release workflow took its version branch and `pnpm version-packages`
 * refused ("no package differs from origin/main"). Listing the app in changesets `ignore` did not
 * help: the changeset is then never consumed and every later run refuses the same way. So a
 * changeset whose every named package is private, or that names any ignored package (the changesets
 * CLI refuses a mixed one inside the release), is refused here, at the PR, where the fix is deleting
 * one file. A change to a private app is recorded in that app's CHANGELOG by hand.
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

/** A file the check must read and cannot is the check failing to run, never the check passing. */
function unreadable(message) {
  console.error(`check-changeset-coverage: ${message}`)
  console.error('  Nothing was verified. This is not a pass.')
  process.exit(2)
}

function readJson(relative) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))
  } catch (err) {
    return unreadable(`${relative} could not be read as JSON — ${err.message}`)
  }
}

/** A YAML scalar without its matching quotes; `undefined` for an unbalanced quote. */
function unquote(text) {
  const first = text.at(0)
  const quoted = first === '"' || first === "'"
  if (quoted && text.length >= 2 && text.at(-1) === first) return text.slice(1, -1)
  if (quoted || text.endsWith('"') || text.endsWith("'")) return undefined
  return text
}

/** The entries of the `packages:` sequence of `pnpm-workspace.yaml`; later keys are not members. */
function workspaceEntries() {
  const file = join(ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return []
  const entries = []
  let inPackages = false
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(line) && !line.startsWith('#')) inPackages = /^packages:\s*$/.test(line)
    const item = line.trim()
    if (inPackages && /^\s/.test(line) && item.startsWith('- ')) {
      const value = unquote(item.slice(2).trim())
      if (value === undefined || value === '') {
        unreadable(`pnpm-workspace.yaml has a packages entry it cannot read: ${item}`)
      }
      entries.push(value)
    }
  }
  return entries
}

/** Directories an entry names: literal segments and whole-segment `*`; any other shape exits 2. */
function expand(entry) {
  let dirs = ['']
  for (const segment of entry.split('/')) {
    if (segment === '*') {
      dirs = dirs.flatMap((d) =>
        existsSync(join(ROOT, d))
          ? readdirSync(join(ROOT, d), { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => join(d, e.name))
          : [],
      )
    } else if (/[*?![\]{}]/.test(segment)) {
      unreadable(
        `pnpm-workspace.yaml entry '${entry}' uses a glob shape this check does not expand.`,
      )
    } else {
      dirs = dirs.map((d) => join(d, segment))
    }
  }
  return dirs
}

/** Every workspace package by name. An absent directory (an uncommitted scratch app) is skipped. */
function workspacePackages() {
  const packages = new Map()
  for (const entry of workspaceEntries()) {
    for (const d of expand(entry)) {
      const manifest = join(d, 'package.json')
      if (!existsSync(join(ROOT, manifest))) continue
      const pkg = readJson(manifest)
      if (typeof pkg.name === 'string') packages.set(pkg.name, { private: pkg.private === true })
    }
  }
  return packages
}

/** changesets accepts globs in `ignore`; `*` matches within one segment of the name. */
function ignoredMatcher() {
  const config = existsSync(join(ROOT, '.changeset', 'config.json'))
    ? readJson('.changeset/config.json')
    : {}
  const ignore = config.ignore ?? []
  if (!Array.isArray(ignore) || !ignore.every((p) => typeof p === 'string')) {
    unreadable('.changeset/config.json `ignore` is not a list of package names.')
  }
  const patterns = ignore.map(
    (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`),
  )
  return (name) => patterns.some((p) => p.test(name))
}

/** A YAML comment starts at a `#` that opens the line or follows whitespace, outside quotes. */
function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quote !== null) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

const BUMPS = new Set(['major', 'minor', 'patch', 'none'])

/** `name: bump`, either side quoted or not; `undefined` for any other line. */
function parseRelease(line) {
  const colon = line.lastIndexOf(':')
  if (colon < 0) return undefined
  const name = unquote(line.slice(0, colon).trim())
  const bump = unquote(line.slice(colon + 1).trim())
  if (name === undefined || !/^[^\s"':]+$/.test(name) || !BUMPS.has(bump)) return undefined
  return name
}

/** The package names a changeset's frontmatter releases. Any line it cannot read exits 2. */
function namedPackages(entry, frontmatter) {
  const named = []
  for (const raw of frontmatter.split(/\r?\n/)) {
    const line = stripComment(raw).trim()
    if (line === '') continue
    const release = parseRelease(line)
    if (release === undefined) {
      unreadable(`.changeset/${entry} has a frontmatter line it cannot read: ${raw.trim()}`)
    }
    named.push(release)
  }
  return named
}

/** Why no release publishes this changeset, or `undefined` when one does. */
function unpublishable(named, packages, isIgnored) {
  const ignored = named.filter(isIgnored)
  if (ignored.length > 0) return ignored.map((n) => `${n} (ignored)`)
  // Every name was checked against the workspace before this is called, so `get` finds each one.
  if (named.length > 0 && named.every((n) => packages.get(n)?.private === true)) {
    return named.map((n) => `${n} (private)`)
  }
  return undefined
}

/**
 * Every package any changeset names, read from the working tree rather than from the range: a
 * changeset added in an earlier commit of the same range still covers the change.
 */
const packages = workspacePackages()
const isIgnored = ignoredMatcher()
const declared = new Set()
const refused = []
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
  const named = namedPackages(entry, front[1])
  for (const name of named) {
    if (!packages.has(name)) {
      unreadable(`.changeset/${entry} names ${name}, which no workspace package declares.`)
    }
    declared.add(name)
  }
  const reasons = unpublishable(named, packages, isIgnored)
  if (reasons !== undefined) refused.push([entry, reasons])
}

const uncovered = [...needing].filter(([name]) => !declared.has(name))
if (uncovered.length === 0 && refused.length === 0) {
  const n = needing.size
  console.log(
    `check-changeset-coverage: ${String(n)} publishable package(s) changed since ${base}, all declared.`,
  )
  process.exit(0)
}

if (refused.length > 0) {
  console.error(
    `check-changeset-coverage: ${String(refused.length)} changeset(s) no release publishes:\n`,
  )
  for (const [entry, reasons] of refused) {
    const only = reasons.length === 1 ? 'only ' : ''
    console.error(
      `  .changeset/${entry}: names ${only}${reasons.join(', ')}, which no release publishes`,
    )
  }
  console.error(
    '\nA private or ignored package is never versioned, so the changeset stays pending and the',
  )
  console.error(
    "Release workflow refuses on every run. Record the change in that package's CHANGELOG and",
  )
  console.error('delete the changeset.\n')
}

if (uncovered.length > 0) {
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
}
process.exit(1)
