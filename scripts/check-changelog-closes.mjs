#!/usr/bin/env node
/**
 * Does a change that closes a registered consumer gap say so where the consumer will read it?
 *
 * The rule and its limits live in `lib/changelog-closes.mjs`. This is the wiring: read the register,
 * read the changed files, read `[Unreleased]`, print.
 *
 * WARN MODE. The register is a heuristic about which files answer which gap, so blocking on it would
 * teach people to route around it. What it must not be is silent.
 *
 * § PATH note — `git` is resolved from PATH. `execFileSync` takes an argv ARRAY, so no shell is
 * spawned and no argument is interpreted; the residual risk is a `git` earlier on PATH than the real
 * one, which is a compromised developer machine rather than an input this script can validate.
 * The repo's existing convention for this is a scoped disable with this note
 * (`verify-version-not-published.mjs:79`), followed here rather than invented differently.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { missingCloses } from './lib/changelog-closes.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTER = join(REPO_ROOT, '.claude', 'rules', 'consumer-gaps.txt')
const CHANGELOG = join(REPO_ROOT, 'CHANGELOG.md')

function readRegister() {
  if (!existsSync(REGISTER)) return []
  const entries = []
  for (const raw of readFileSync(REGISTER, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length !== 3) {
      console.warn(`[changelog-closes] malformed register line ignored: ${line}`)
      continue
    }
    entries.push({
      id: parts[0],
      files: parts[1]
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
      summary: parts[2],
    })
  }
  return entries
}

/** Files this branch changed against its base. `develop` is the integration branch (git-safety § 1). */
function changedFiles() {
  const base = process.argv[2] ?? 'origin/develop'
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    return out
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
  } catch {
    // No base to compare against (a fresh clone, a detached CI checkout). Saying so beats comparing
    // against nothing and reporting a clean run.
    console.log(`[changelog-closes] SKIP — could not diff against ${base}.`)
    return undefined
  }
}

const files = changedFiles()
if (files === undefined) process.exit(0)

const found = missingCloses({
  changedFiles: files,
  changelog: existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '',
  registry: readRegister(),
})

if (found.length === 0) {
  console.log('[changelog-closes] OK — no registered consumer gap was closed without saying so.')
  process.exit(0)
}

console.log(
  `[changelog-closes] ${String(found.length)} registered consumer gap(s) may have been closed ` +
    `without a note the consumer can find. Five closures reached them by accident last time, ` +
    `because the same person maintains both sides; a customer without that overlap keeps ` +
    `rebuilding what already ships.`,
)
for (const gap of found) {
  console.log(`  ${gap.id} — ${gap.summary}`)
  console.log(`      touched: ${gap.files.join(', ')}`)
}
console.log(
  `\nIf this change closes one, add \`(closes: ${found[0].id})\` to its CHANGELOG entry under ` +
    `[Unreleased]. If it does not, nothing to do — the register in ` +
    `${relative(REPO_ROOT, REGISTER)} maps files to gaps heuristically and will over-fire.`,
)
process.exit(0)
