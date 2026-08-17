#!/usr/bin/env node
/**
 * Supply-chain guard — every production dependency carries a licence this project can ship.
 *
 * ## Why a gate and not a review
 *
 * A licence obligation arrives silently. Nothing fails, nothing warns; a transitive dependency
 * changes its terms in a patch release and the obligation is simply inherited. The last sweep found
 * three of OUR OWN packages published with no `license` field at all — and a tarball with no licence
 * is "all rights reserved" to whoever installs it, which is the opposite of what shipping an open
 * framework means.
 *
 * ## The policy, and why each line is here
 *
 * ALLOWED is the permissive set this project already depends on. It is not aspirational: every entry
 * was measured in the current production tree before being written down.
 *
 * ALLOWED_WITH_REASON is narrower and each entry states its own justification. These are NOT
 * blanket exceptions — a licence lands here only when its obligation is understood and discharged.
 *
 * Anything else FAILS, including `Unknown`. "The field is missing" and "the licence is permissive"
 * are different facts, and a gate that treats the first as the second is the kind that certifies by
 * absence — the failure this repository has been unpicking all cycle.
 *
 * Scope is `--prod` deliberately. A dev-tree licence never reaches a consumer; a production one is
 * inherited by every app built on the framework. Auditing both under one threshold would make the
 * gate red for a reason nobody can act on, and a permanently red gate teaches people to ignore red.
 *
 * Usage: `node scripts/check-licenses.mjs`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Permissive licences with no obligation beyond attribution in the distributed source. */
const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
])

/**
 * Licences accepted with the obligation named. Each key is the exact SPDX string as reported.
 */
const ALLOWED_WITH_REASON = new Map([
  [
    'MPL-2.0',
    'File-level copyleft: obligations attach to MODIFIED files of the dependency itself, not to code ' +
      'that merely uses it. Present through lightningcss, a build-time CSS toolchain consumed as a ' +
      'binary and never vendored or patched here.',
  ],
  [
    'CC-BY-4.0',
    'Attribution-only, and it covers DATA rather than code: caniuse-lite ships browser-support tables ' +
      'consumed by the build. No source of this project derives from it.',
  ],
])

/**
 * A disjunction (`MIT OR Apache-2.0`) is satisfiable if ANY branch is acceptable — the consumer picks.
 * Parsed rather than string-matched so a new arrangement of the same terms does not read as unknown.
 */
function branches(expression) {
  // Tokenised rather than split on /\s+OR\s+/: two greedy quantifiers around a literal backtrack
  // super-linearly, and a licence string is third-party input. The same rewrite was applied to the
  // parity gate's `as` extraction for the same reason.
  const parts = []
  let current = []
  for (const token of expression.replace(/[()]/g, ' ').split(' ')) {
    const t = token.trim()
    if (t.length === 0) continue
    if (t.toUpperCase() === 'OR') {
      if (current.length > 0) parts.push(current.join(' '))
      current = []
    } else {
      current.push(t)
    }
  }
  if (current.length > 0) parts.push(current.join(' '))
  return parts
}

/**
 * Signatures of the licence TEXT, for packages that ship the terms but omit the manifest field.
 * Deliberately anchored on wording no other licence carries, so a copyleft file cannot match one of
 * these by accident.
 */
const TEXT_SIGNATURES = [
  [(text) => /\bMIT License\b/i.test(text), 'MIT'],
  [(text) => /\bApache License\b/i.test(text) && /Version 2\.0/i.test(text), 'Apache-2.0'],
  [(text) => /\bISC License\b/i.test(text), 'ISC'],
  // Two independent tests rather than one spanning match: a regex that walks thousands of
  // characters between two anchors backtracks, and a licence file is attacker-controlled input
  // whenever a dependency is.
  [
    (text) =>
      /Redistribution and use in source and binary forms/i.test(text) &&
      /Neither the name/i.test(text),
    'BSD-3-Clause',
  ],
]

const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING)(?:\.\w+)?$/i

/**
 * An absent manifest field is not evidence of an absent licence — both offenders in the last sweep
 * shipped the full terms in a file and simply forgot the key. Read the file rather than guessing:
 * a blind allowlist entry would also accept the day one of them changes terms.
 */
function classifyFromShippedText(paths) {
  for (const dir of paths ?? []) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries.filter((e) => LICENSE_FILE.test(e))) {
      let text
      try {
        text = readFileSync(join(dir, entry), 'utf8').slice(0, 8000)
      } catch {
        continue
      }
      for (const [matches, spdx] of TEXT_SIGNATURES) {
        if (matches(text)) return { spdx, file: join(dir, entry) }
      }
    }
  }
  return undefined
}

function verdict(expression, pkg) {
  if (expression === 'Unknown' || expression.trim().length === 0) {
    const found = classifyFromShippedText(pkg?.paths)
    if (found !== undefined && ALLOWED.has(found.spdx)) {
      return {
        ok: true,
        note: `manifest declares no licence, but the tarball ships ${found.spdx} terms (${found.file})`,
      }
    }
    return { ok: false, why: 'no licence declared and none found in the shipped files' }
  }
  const parts = branches(expression)
  if (parts.some((p) => ALLOWED.has(p))) return { ok: true }
  const reasoned = parts.find((p) => ALLOWED_WITH_REASON.has(p))
  if (reasoned !== undefined) return { ok: true, note: ALLOWED_WITH_REASON.get(reasoned) }
  return { ok: false, why: 'not on the allowlist' }
}

let report
try {
  report = JSON.parse(
    // `pnpm` from the toolchain: the repository's own package manager, resolved the way every
    // other script here resolves it. An absolute path would break on every machine whose pnpm
    // lives elsewhere.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
} catch (err) {
  console.error('check-licenses: `pnpm licenses list --prod --json` failed')
  console.error(String(err?.stderr ?? err))
  process.exit(1)
}

const packageCount = Object.values(report).reduce((n, list) => n + list.length, 0)

// Non-vacuity floor. An empty or unreadable report yields zero violations and exits 0, which is a
// gate certifying that it did not run.
if (packageCount === 0) {
  console.error('check-licenses: the report listed no package — nothing was audited')
  process.exit(1)
}

const violations = []
const noted = new Map()
for (const [expression, packages] of Object.entries(report)) {
  for (const pkg of packages) {
    const v = verdict(expression, pkg)
    if (!v.ok) {
      violations.push({ name: pkg.name, expression, why: v.why })
    } else if (v.note !== undefined) {
      const key = `${expression}:${v.note}`
      noted.set(key, { note: v.note, count: (noted.get(key)?.count ?? 0) + 1, expression })
    }
  }
}

for (const { note, count, expression } of noted.values()) {
  console.log(`· ${expression} (${count}) — ${note}`)
}

if (violations.length > 0) {
  console.error(`\n✗ ${violations.length} production package(s) with an unacceptable licence:`)
  for (const v of violations) console.error(`    ${v.name}: ${v.expression} — ${v.why}`)
  console.error(
    '\nA missing licence field makes a tarball all-rights-reserved for whoever installs it. If the\n' +
      'package is ours, add the field and republish; if it is third-party, verify the terms and add\n' +
      'the exact SPDX string to ALLOWED or ALLOWED_WITH_REASON with the obligation written down.',
  )
  process.exit(1)
}

console.log(`\n✓ ${packageCount} production packages, every licence accounted for`)
