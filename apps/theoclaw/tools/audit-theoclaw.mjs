#!/usr/bin/env node
/**
 * Fails on any known advisory that reaches TheoClaw, and ignores the rest of the workspace (B-406).
 *
 * `pnpm --filter theoclaw audit` is refused by pnpm, and the workspace audit in CI is production-only
 * and red for other importers. So this runs `pnpm audit --json` once over the whole workspace and
 * keeps an advisory only when one of its paths starts at the `apps/theoclaw` importer, dev tree
 * included. pnpm's own exit code is never read: it is non-zero whenever any importer has an advisory.
 *
 * pnpm reports a dependency of a `workspace:*` package under that package's own importer
 * (`packages__agents>...`), never through the app that links it. So the importers TheoClaw links,
 * read from pnpm-lock.yaml and followed through their own production links, are in scope too, for
 * the production dependencies TheoClaw installs from them (their devDependencies are not installed).
 * A peer a linked package declares only as its own devDependency is out of that scope; it is in
 * scope when TheoClaw declares the package itself.
 * The app's importer is derived from where this file lives, and a lockfile without it exits 2, so a
 * moved app fails closed instead of matching no path.
 *
 * Exit 0 with no TheoClaw advisory, 1 with one line per advisory, 2 when the report cannot be read.
 * A malformed advisory exits 2 even when it reaches only another importer: without its paths the
 * tool cannot tell whether it reaches TheoClaw, so it fails closed rather than guessing.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const LOCKFILE = 'pnpm-lock.yaml'
/** The lockfile importer key of the app this tool belongs to, e.g. `apps/theoclaw`. */
export const APP_IMPORTER = relative(REPO_ROOT, fileURLToPath(new URL('../', import.meta.url))).split(sep).join('/')
const PRODUCTION_SECTIONS = new Set(['dependencies', 'optionalDependencies'])
const MAX_BUFFER = 64 * 1024 * 1024
const HEAD_CHARS = 400

/** Thrown when the audit report cannot be judged, so it is never read as "an advisory was found". */
class AuditReportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuditReportError'
  }
}

/** pnpm audit's id for an importer key: `apps/theoclaw` -> `apps__theoclaw`. */
const importerId = (key) => key.split('/').join('__')

/** One `key:` or `key: value` line of the importers block, with its indentation. */
const LOCK_ENTRY = /^( {2,8})(\S.*?):(?: (.+))?$/

const unquote = (text) => text.replace(/^'(.*)'$/, '$1')

/** What each indentation of the importers block opens: an importer, a section, a dependency, its version. */
const ENTRY_BY_INDENT = {
  2: (state, key) => {
    state.deps = []
    state.importers.set(unquote(key), state.deps)
  },
  4: (state, key) => {
    state.section = key
  },
  6: (state, key) => {
    state.name = unquote(key)
  },
  8: (state, key, value) => {
    if (key === 'version' && state.deps) state.deps.push({ section: state.section, name: state.name, version: unquote(value ?? '') })
  },
}

/**
 * The `importers:` block of a pnpm lockfile as `Map<key, [{ section, name, version }]>`.
 * Line-based: pnpm writes this block with fixed two-space indentation.
 */
function readImporters(lockText) {
  const state = { importers: new Map(), deps: null, section: null, name: null }
  let inBlock = false
  for (const line of lockText.split('\n')) {
    if (/^\S/.test(line)) inBlock = line === 'importers:'
    const entry = inBlock ? LOCK_ENTRY.exec(line) : null
    if (entry) ENTRY_BY_INDENT[entry[1].length]?.(state, entry[2], entry[3])
  }
  return state.importers
}

/**
 * Which audit paths reach TheoClaw: `Map<importer id, Set<direct dependency name> | null>`, where
 * `null` (the app itself) admits every path and a set admits only paths through those dependencies.
 * Throws `AuditReportError` when the lockfile has no importer for the app.
 */
export function auditScope(lockText) {
  const importers = readImporters(lockText)
  if (!importers.has(APP_IMPORTER)) throw new AuditReportError(`no ${APP_IMPORTER} importer in ${LOCKFILE}`)
  const scope = new Map([[importerId(APP_IMPORTER), null]])
  const pending = [APP_IMPORTER]
  while (pending.length > 0) {
    const key = pending.pop()
    const isApp = key === APP_IMPORTER
    for (const dep of importers.get(key) ?? []) {
      if (!dep.version.startsWith('link:') || !(isApp || PRODUCTION_SECTIONS.has(dep.section))) continue
      const linked = posix.normalize(posix.join(key, dep.version.slice('link:'.length)))
      if (scope.has(importerId(linked))) continue
      if (!importers.has(linked)) throw new AuditReportError(`${key} links ${linked}, which is no importer in ${LOCKFILE}`)
      const production = importers.get(linked).filter((d) => PRODUCTION_SECTIONS.has(d.section))
      scope.set(importerId(linked), new Set(production.map((d) => d.name)))
      pending.push(linked)
    }
  }
  return scope
}

/** True when an audit path (`importer>dep>...`) starts at an importer of `scope`, through a dependency it admits. */
function reaches(scope, path) {
  const [importer, direct] = path.split('>')
  if (!scope.has(importer)) return false
  const admitted = scope.get(importer)
  return admitted === null || direct === undefined || admitted.has(direct)
}

const isFinding = (f) =>
  f !== null && typeof f.version === 'string' && Array.isArray(f.paths) && f.paths.every((p) => typeof p === 'string')

/** Throws when an advisory lacks a field the printed line or the path match reads. */
function assertShape(id, advisory) {
  const ok =
    advisory !== null &&
    typeof advisory === 'object' &&
    ['module_name', 'severity', 'github_advisory_id'].every((key) => typeof advisory[key] === 'string') &&
    Array.isArray(advisory.findings) &&
    advisory.findings.every(isFinding)
  if (!ok) throw new AuditReportError(`advisory ${id} is malformed`)
}

/** The first path of `advisory` that reaches TheoClaw, with the finding's version, or `null`. */
function firstTheoclawFinding(advisory, scope) {
  for (const finding of advisory.findings) {
    const path = finding.paths.find((p) => reaches(scope, p))
    if (path) return { version: finding.version, path }
  }
  return null
}

/**
 * `{ severity, ghsa, module, version, path }` for each advisory with a path through TheoClaw, as
 * `scope` (from `auditScope`) defines it.
 * Throws `AuditReportError` when the report, or one advisory in it, cannot be judged.
 */
export function theoclawAdvisories(report, scope) {
  if (report === null || typeof report !== 'object' || report.advisories === null || typeof report.advisories !== 'object') {
    throw new AuditReportError('the report has no advisories object')
  }
  const kept = []
  for (const [id, advisory] of Object.entries(report.advisories)) {
    assertShape(id, advisory)
    const hit = firstTheoclawFinding(advisory, scope)
    if (hit) {
      kept.push({
        severity: advisory.severity,
        ghsa: advisory.github_advisory_id,
        module: advisory.module_name,
        version: hit.version,
        path: hit.path,
      })
    }
  }
  return kept
}

/** 1 when any advisory reaches TheoClaw, whatever its severity; 0 otherwise. */
export function auditExitCode(kept) {
  return kept.length > 0 ? 1 : 0
}

const head = (text) => String(text ?? '').trim().slice(0, HEAD_CHARS)

/** What pnpm did, for an exit-2 line: its status or signal, and the heads of both streams. */
function describeRun(result) {
  const ended = result.signal ? `signal ${result.signal}` : `exit ${result.status}`
  return `pnpm audit ${ended}; stdout: ${head(result.stdout) || '(empty)'}; stderr: ${head(result.stderr) || '(empty)'}`
}

/** The parsed report, or an `AuditReportError` naming what pnpm did. */
function parseRun(result) {
  if (result.error) throw new AuditReportError(`cannot run pnpm audit: ${result.error.message} (${describeRun(result)})`)
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new AuditReportError(`pnpm audit printed no JSON (${describeRun(result)})`)
  }
}

/** The lockfile text through `readFile`, or an `AuditReportError` naming why it cannot be read. */
function readLockfile(readFile) {
  try {
    return readFile(`${REPO_ROOT}${LOCKFILE}`)
  } catch (error) {
    throw new AuditReportError(`cannot read ${LOCKFILE}: ${error.message}`)
  }
}

/**
 * Runs the audit through `spawn`, scoped by the lockfile `readFile` returns, writes one line per
 * TheoClaw advisory, and returns the exit code.
 */
export function runAudit({ spawn, readFile, write, writeError }) {
  let kept
  try {
    const scope = auditScope(readLockfile(readFile))
    // The repository's own pnpm, resolved from PATH as every CI step and script here does.
    const result = spawn('pnpm', ['audit', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER })
    kept = theoclawAdvisories(parseRun(result), scope)
  } catch (error) {
    if (!(error instanceof AuditReportError)) throw error
    writeError(error.message)
    return 2
  }
  for (const a of kept) write(`${a.severity} ${a.ghsa} ${a.module}@${a.version} ${a.path}`)
  return auditExitCode(kept)
}

/** True when Node was started on this file (real paths on both sides, as check-parity-ledger.mjs does). */
function isDirectRun() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

if (isDirectRun()) {
  process.exitCode = runAudit({
    spawn: spawnSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    write: console.log,
    writeError: console.error,
  })
}
