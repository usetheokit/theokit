#!/usr/bin/env node
/**
 * check-app-dependencies.mjs <app-dir> [--json]
 *
 * Runs the exact-pin check and the @theokit staleness check over `<app-dir>/package.json` and
 * `<app-dir>/packages/*\/package.json`. Exit 1 on an exact-pin violation, 2 when it cannot judge.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  channelFor,
  collectDeclarations,
  compareVersions,
  exactVersionViolations,
  overrideSelectors,
  theokitStaleness,
} from './lib/app-dependencies.mjs'

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function manifestPaths(appDir) {
  const found = [join(appDir, 'package.json')]
  const packagesDir = join(appDir, 'packages')
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir).sort()) {
      const path = join(packagesDir, entry, 'package.json')
      if (existsSync(path)) found.push(path)
    }
  }
  return found
}

function readManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new TypeError('not a JSON object')
  return manifest
}

const readVersion = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).version
  } catch {
    return undefined
  }
}

/** Node's lookup of `name` from `dir` (own node_modules, then each ancestor's); the package's real directory. */
function resolvePackage(dir, name) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    const candidate = join(current, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(current) === current) return undefined
  }
}

/** Caret: `^0.x` pins the minor, `^0.0.x` pins the patch. */
function caretAllows([major, minor, patch], want) {
  if (major > 0) return minor > want[1] || (minor === want[1] && patch >= (want[2] ?? 0))
  if (minor !== want[1]) return false
  if (want[2] === undefined) return true
  return minor > 0 ? patch >= want[2] : patch === want[2]
}

const parseVersion = (v) => String(v).split('+')[0].split('-')[0].split('.').map(Number)

/**
 * Whether `version` satisfies `range` for exact, caret, tilde and x-ranges; undefined for a range
 * form this tool does not parse (the caller then accepts the version).
 */
function satisfiesRange(version, range) {
  const text = String(range).trim()
  if (EXACT_VERSION.test(text)) return compareVersions(version, text) === 0
  const match = /^([\^~]?)(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(text)
  if (!match) return undefined
  if (version.split('+')[0].includes('-')) return false
  const [major, minor, patch] = parseVersion(version)
  const [, op, m, n, p] = match
  const want = [
    Number(m),
    /^\d+$/.test(n ?? '') ? Number(n) : undefined,
    /^\d+$/.test(p ?? '') ? Number(p) : undefined,
  ]
  if (major !== want[0]) return false
  if (want[1] === undefined) return true
  if (op === '') return minor === want[1] && (want[2] === undefined || patch === want[2])
  if (op === '~') return minor === want[1] && patch >= (want[2] ?? 0)
  // caret: ^0.x pins the minor, ^0.0.x pins the patch
  return caretAllows([major, minor, patch], want)
}

const readDeps = (dir) => {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return [m.dependencies, m.devDependencies, m.optionalDependencies, m.peerDependencies].flatMap(
      (d) => (d && typeof d === 'object' ? Object.keys(d) : []),
    )
  } catch {
    return []
  }
}

/**
 * Real directories of every installed copy of `name` that a package in `starts`, or anything beneath
 * it in the dependency graph, resolves.
 */
function installedCopies(starts, name) {
  const found = []
  const seen = new Set()
  const queue = [...starts]
  while (queue.length > 0) {
    const current = queue.shift()
    if (seen.has(current)) continue
    seen.add(current)
    const own = resolvePackage(current, name)
    if (own !== undefined && !found.includes(own)) found.push(own)
    for (const dep of readDeps(current)) {
      const next = resolvePackage(current, dep)
      if (next !== undefined) queue.push(next)
    }
  }
  return found
}

/** Every installed copy an override path applies to: each ancestor anywhere beneath the one before it. */
function overrideTargets(dir, segments) {
  let frontier = [resolve(dir)]
  for (const { name, spec } of segments) {
    // A selector such as `c@1` applies only to installed copies of that version.
    frontier = installedCopies(frontier, name).filter((copy) => {
      const version = readVersion(join(copy, 'package.json'))
      return spec === undefined || version === undefined || satisfiesRange(version, spec) !== false
    })
    if (frontier.length === 0) return []
  }
  return frontier
}

/**
 * The installed version a declaration resolves to, from the installation itself (pnpm links or a flat
 * node_modules). A dependency resolves from its manifest's directory. An override applies to every
 * installed copy of its package beneath each installed copy of its ancestors, wherever they sit in the
 * dependency graph; all of them must resolve to one version satisfying the override's range, otherwise
 * (differing, unreadable or non-matching copies, or a range this tool cannot evaluate) it is left unjudged.
 */
function installedFrom(dir) {
  return (name, declaration) => {
    if (declaration.override === undefined) {
      const own = resolvePackage(dir, name)
      return own === undefined ? undefined : readVersion(join(own, 'package.json'))
    }
    const versions = new Set()
    for (const target of overrideTargets(dir, overrideSelectors(declaration.override))) {
      const version = readVersion(join(target, 'package.json'))
      if (version === undefined || satisfiesRange(version, declaration.range) !== true)
        return undefined
      versions.add(version)
    }
    return versions.size === 1 ? [...versions][0] : undefined
  }
}

function npmTags(name) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
  const out = execFileSync('npm', ['view', name, 'dist-tags', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim())
}

/** The tag matching the installed channel, falling back to `latest`; undefined when npm cannot answer. */
function publishedFor(installed, name, failures, publishedTags) {
  try {
    const tags = publishedTags(name)
    return tags[channelFor(installed)] ?? tags.latest
  } catch (error) {
    failures.push({ name, reason: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}

function checkManifest(path, failures, publishedTags) {
  const manifest = readManifest(path)
  const violations = exactVersionViolations(manifest).map((v) => ({ manifest: path, ...v }))
  const declarations = collectDeclarations(manifest)
  // Resolved from the declaring manifest's own directory: pnpm links a package's dependencies there.
  const installedVersion = installedFrom(dirname(path))
  const staleness = declarations.some((d) => d.name.startsWith('@theokit/'))
    ? theokitStaleness(declarations, {
        installedVersion,
        publishedVersion: (name, installed) =>
          publishedFor(installed, name, failures, publishedTags),
      })
    : { rows: [], inRepo: [], unjudged: [] }
  return { manifest: path, violations, ...staleness }
}

function render(report, write) {
  for (const v of report.violations) write(`${v.manifest}: ${v.section} ${v.name} ${v.specifier}`)
  if (report.inRepo.length > 0)
    write(`in-repo (not compared with the registry): ${report.inRepo.join(', ')}`)
  for (const u of report.unjudged) {
    const via = u.override ? ` (override ${u.override})` : ''
    write(`${u.manifest}: ${u.name}${via} cannot be judged (${u.reason})`)
  }
  for (const r of report.rows) {
    if (!r.current)
      write(
        `${r.manifest}: ${r.name} installed ${r.installed}, published ${r.latest}${r.major ? ' (major)' : ''}`,
      )
  }
}

/** Judges the app at `appDir`, writes the report, and returns the exit code. */
export function runCli({ appDir, json = false, write, writeError, publishedTags = npmTags }) {
  const failures = []
  const results = []
  try {
    for (const path of manifestPaths(appDir))
      results.push(checkManifest(path, failures, publishedTags))
  } catch (error) {
    writeError(`cannot read ${appDir}: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const report = {
    violations: results.flatMap((r) => r.violations),
    rows: results.flatMap((r) => r.rows.map((row) => ({ manifest: r.manifest, ...row }))),
    inRepo: [...new Set(results.flatMap((r) => r.inRepo))].sort(),
    unjudged: results.flatMap((r) => r.unjudged.map((u) => ({ manifest: r.manifest, ...u }))),
    failures,
  }
  if (json) write(JSON.stringify(report, null, 2))
  else render(report, write)
  for (const f of failures) writeError(`could not read published version of ${f.name}: ${f.reason}`)
  return exitCode(report)
}

/** 1 for an exact-pin violation or a registry pin behind; 2 when a pin could not be judged; else 0. */
function exitCode(report) {
  if (report.violations.length > 0 || report.rows.some((r) => !r.current)) return 1
  return report.unjudged.length > 0 ? 2 : 0
}

function isDirectRun() {
  try {
    return (
      Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    )
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

if (isDirectRun()) {
  const args = process.argv.slice(2)
  const appDir = args.find((a) => !a.startsWith('--'))
  if (appDir) {
    process.exitCode = runCli({
      appDir,
      json: args.includes('--json'),
      write: console.log,
      writeError: console.error,
    })
  } else {
    console.error('usage: check-app-dependencies.mjs <app-dir> [--json]')
    process.exitCode = 2
  }
}
