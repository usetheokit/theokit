#!/usr/bin/env node
/**
 * check-app-dependencies.mjs <app-dir> [--json]
 *
 * Runs the exact-pin check and the @theokit staleness check over `<app-dir>/package.json` and
 * `<app-dir>/packages/*\/package.json`. Exit 1 on an exact-pin violation, 2 when it cannot judge.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  channelFor,
  collectDeclarations,
  exactVersionViolations,
  theokitStaleness,
} from './lib/app-dependencies.mjs'

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

function installedFrom(dir) {
  return (name) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8'))
        .version
    } catch {
      return undefined
    }
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
        publishedVersion: (name) =>
          publishedFor(installedVersion(name), name, failures, publishedTags),
      })
    : { rows: [], inRepo: [], unjudged: [] }
  return { manifest: path, violations, ...staleness }
}

function render(report, write) {
  for (const v of report.violations) write(`${v.manifest}: ${v.section} ${v.name} ${v.specifier}`)
  for (const u of report.unjudged) write(`${u.manifest}: ${u.name} cannot be judged (${u.reason})`)
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
