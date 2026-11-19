#!/usr/bin/env node
/**
 * Refuses every dependency specifier in a manifest that is not an exact version (B-406, REQ-8).
 *
 * A `^`-only grep would pass `~`, `>=`, `*`, `latest` and the protocol forms, so the rule is stated
 * positively: a specifier is accepted only when it is `MAJOR.MINOR.PATCH` with an optional
 * prerelease, or exactly `workspace:*`. Everything else is a violation.
 *
 * Exit 0 with no violation, 1 with one line per violation, 2 when the manifest cannot be judged.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { exactVersionViolations as sharedExactVersionViolations } from '../../../scripts/lib/app-dependencies.mjs'

/** Thrown when a manifest cannot be judged at all, as opposed to holding a range. */
class ManifestShapeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ManifestShapeError'
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * `{ section, name, specifier }` for every non-exact entry, in section order. An absent section is
 * empty; a section present but not a plain object throws `ManifestShapeError`. The rule is the shared
 * one; TheoClaw's check has never judged `peerDependencies`, so those are left out.
 */
export function exactVersionViolations(manifest) {
  const judged = { ...manifest }
  delete judged.peerDependencies
  try {
    return sharedExactVersionViolations(judged)
  } catch (error) {
    if (error instanceof TypeError) throw new ManifestShapeError(error.message)
    throw error
  }
}

/** The parsed manifest at `path`; throws `ManifestShapeError` naming why it cannot be read. */
function readManifest(path) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ManifestShapeError(error.code ?? error.message)
  }
  if (!isPlainObject(manifest)) throw new ManifestShapeError('not a JSON object')
  return manifest
}

/** Judges the manifest at `path`, writes one line per violation, and returns the exit code. */
export function runCli({ path, write, writeError }) {
  let violations
  try {
    violations = exactVersionViolations(readManifest(path))
  } catch (error) {
    if (!(error instanceof ManifestShapeError)) throw error
    writeError(`cannot read ${path}: ${error.message}`)
    return 2
  }
  for (const v of violations) write(`${v.section} ${v.name} ${v.specifier}`)
  return violations.length > 0 ? 1 : 0
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
  const path = process.argv[2]
  if (path) {
    process.exitCode = runCli({ path, write: console.log, writeError: console.error })
  } else {
    console.error('usage: check-exact-versions.mjs <package.json>')
    process.exitCode = 2
  }
}
