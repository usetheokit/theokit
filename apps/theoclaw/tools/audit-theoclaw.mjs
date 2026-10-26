#!/usr/bin/env node
/**
 * Fails on any known advisory that reaches TheoClaw, and ignores the rest of the workspace (B-406).
 *
 * `pnpm --filter theoclaw audit` is refused by pnpm, and the workspace audit in CI is production-only
 * and red for other importers. So this runs `pnpm audit --json` once over the whole workspace and
 * keeps an advisory only when one of its paths starts at the `apps/theoclaw` importer, dev tree
 * included. pnpm's own exit code is never read: it is non-zero whenever any importer has an advisory.
 *
 * Exit 0 with no TheoClaw advisory, 1 with one line per advisory, 2 when the report cannot be read.
 * A malformed advisory exits 2 even when it reaches only another importer: without its paths the
 * tool cannot tell whether it reaches TheoClaw, so it fails closed rather than guessing.
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const IMPORTER = 'apps__theoclaw'
const MAX_BUFFER = 64 * 1024 * 1024
const HEAD_CHARS = 400

/** Thrown when the audit report cannot be judged, so it is never read as "an advisory was found". */
class AuditReportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuditReportError'
  }
}

const reachesTheoclaw = (path) => path === IMPORTER || path.startsWith(`${IMPORTER}>`)

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
function firstTheoclawFinding(advisory) {
  for (const finding of advisory.findings) {
    const path = finding.paths.find(reachesTheoclaw)
    if (path) return { version: finding.version, path }
  }
  return null
}

/**
 * `{ severity, ghsa, module, version, path }` for each advisory with a path through TheoClaw.
 * Throws `AuditReportError` when the report, or one advisory in it, cannot be judged.
 */
export function theoclawAdvisories(report) {
  if (report === null || typeof report !== 'object' || report.advisories === null || typeof report.advisories !== 'object') {
    throw new AuditReportError('the report has no advisories object')
  }
  const kept = []
  for (const [id, advisory] of Object.entries(report.advisories)) {
    assertShape(id, advisory)
    const hit = firstTheoclawFinding(advisory)
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

/** Runs the audit through `spawn`, writes one line per TheoClaw advisory, and returns the exit code. */
export function runAudit({ spawn, write, writeError }) {
  // The repository's own pnpm, resolved from PATH as every CI step and script here does.
  const result = spawn('pnpm', ['audit', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER })
  let kept
  try {
    kept = theoclawAdvisories(parseRun(result))
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
  process.exitCode = runAudit({ spawn: spawnSync, write: console.log, writeError: console.error })
}
