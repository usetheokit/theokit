#!/usr/bin/env node
/**
 * Dependency checks for one app under `apps/`: `check-app-dependencies.mjs <app-dir> [--json]`.
 *
 * Runs the exact-pin check and the `@theokit/*` staleness check over `<app-dir>/package.json` and
 * `<app-dir>/packages/*\/package.json`. Exit 0 clean, 1 a violation or a registry pin behind,
 * 2 when it could not run.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { exactVersionViolations, publishedFor, theokitStaleness } from './lib/app-dependencies.mjs'

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']

/** `npm view <name> dist-tags --json`, the same call TheoCode's script makes. */
function npmDistTags(name) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
  const out = execFileSync('npm', ['view', name, 'dist-tags', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim())
}

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

function installedIn(path, name) {
  const file = join(path, '..', 'node_modules', name, 'package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version
  } catch {
    return undefined
  }
}

/**
 * Judge `appDir`. `tagsFor(name)` returns the dist-tags map and is injectable so tests skip the network.
 * Returns the exit code.
 */
function collect(appDir, paths) {
  const violations = []
  const declarations = []
  const installedBy = new Map()
  for (const path of paths) {
    const label = relative(appDir, path) || 'package.json'
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    for (const v of exactVersionViolations(manifest)) violations.push({ manifest: label, ...v })
    for (const field of DEP_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        declarations.push({ name, range })
        const installed = installedIn(path, name)
        if (installed !== undefined && !installedBy.has(name)) installedBy.set(name, installed)
      }
    }
  }
  return { violations, declarations, installedBy }
}

function lookUpPublished(declarations, installedBy, tagsFor) {
  const published = new Map()
  const failures = []
  const names = new Set(
    declarations.filter((d) => d.name.startsWith('@theokit/')).map((d) => d.name),
  )
  for (const name of names) {
    try {
      published.set(name, publishedFor(installedBy.get(name), tagsFor(name)))
    } catch (error) {
      failures.push({ name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { published, failures }
}

function render({ violations, behind, failures }, write, writeError) {
  for (const v of violations)
    write(`${v.manifest}: ${v.section} ${v.name} ${v.specifier} is not an exact version`)
  for (const r of behind)
    write(`${r.name}: installed ${r.installed}, published ${r.latest}${r.major ? ' (major)' : ''}`)
  for (const f of failures) writeError(`${f.name}: registry lookup failed: ${f.reason}`)
}

export function runCli({ appDir, json = false, write, writeError, tagsFor = npmDistTags }) {
  const paths = manifestPaths(appDir)
  if (!existsSync(paths[0])) {
    writeError(`cannot read ${paths[0]}: ENOENT`)
    return 2
  }
  let collected
  try {
    collected = collect(appDir, paths)
  } catch (error) {
    writeError(`cannot read manifests under ${appDir}: ${error.message}`)
    return 2
  }
  const { violations, declarations, installedBy } = collected
  const { published, failures } = lookUpPublished(declarations, installedBy, tagsFor)
  const { rows, inRepo } = theokitStaleness(declarations, {
    installedVersion: (name) => installedBy.get(name),
    publishedVersion: (name) => published.get(name),
  })
  const behind = rows.filter((r) => !r.current)

  if (json) write(JSON.stringify({ violations, rows, inRepo, failures }, null, 2))
  else render({ violations, behind, failures }, write, writeError)
  if (violations.length > 0 || behind.length > 0) return 1
  return failures.length > 0 ? 2 : 0
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
