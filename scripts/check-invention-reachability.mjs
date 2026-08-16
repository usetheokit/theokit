#!/usr/bin/env node
/**
 * The inverse of `check-surface-parity.mjs`.
 *
 * Parity asks whether the layer forwards what the SDK exports at a shared subpath name; its own
 * contract says that is all it can ask, and it skips 14 own-surface subpaths with the reason
 * written down. This asks the question nothing asked: when the layer invents a capability, can a
 * consumer USE it — or did the type cross the boundary while the enforcement stayed behind?
 *
 * The rule and its limits live in `lib/invention-reachability.mjs`. This file is the wiring: find
 * the modules, find what the built package declares, read the allowlist, print.
 *
 * WARN MODE. It exits 0 on findings, deliberately: the rule is a heuristic and a heuristic that
 * blocks CI teaches people to route around it. What it must never do is be silent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { declaredExportsFromText } from './lib/declared-exports.mjs'
import { findUnreachableEnforcement } from './lib/invention-reachability.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'agents')
const ALLOWLIST = join(REPO_ROOT, '.claude', 'rules', 'invention-reachability-allowlist.txt')

/** @param {string} dir @param {RegExp} match @returns {string[]} */
function walk(dir, match) {
  if (!existsSync(dir)) return []
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, match))
    else if (match.test(entry)) out.push(full)
  }
  return out
}

/** Entries, ignoring comments and blanks. A malformed line is reported, never silently dropped. */
function readAllowlist() {
  if (!existsSync(ALLOWLIST)) return { entries: [], malformed: [] }
  /** @type {{symbol: string, sunset: string, rationale: string}[]} */
  const entries = []
  /** @type {string[]} */
  const malformed = []
  for (const raw of readFileSync(ALLOWLIST, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      malformed.push(line)
      continue
    }
    entries.push({ symbol: parts[0], sunset: parts[1], rationale: parts[2] })
  }
  return { entries, malformed }
}

function publishedNames() {
  const dist = join(PACKAGE_DIR, 'dist')
  const dts = walk(dist, /\.d\.[cm]?ts$/)
  if (dts.length === 0) {
    // Distinguished from "nothing is published": an unbuilt package would make every type look
    // unreachable and turn the whole report into noise.
    return undefined
  }
  const text = dts.map((f) => readFileSync(f, 'utf8')).join('\n')
  return declaredExportsFromText(text, join(PACKAGE_DIR, 'package.json')).names
}

const names = publishedNames()
if (names === undefined) {
  console.log(
    '[invention-reachability] SKIP — packages/agents/dist is absent. Run the build first.',
  )
  process.exit(0)
}

const { entries, malformed } = readAllowlist()
for (const line of malformed) {
  console.warn(`[invention-reachability] malformed allowlist line ignored: ${line}`)
}

const modules = walk(join(PACKAGE_DIR, 'src'), /\.ts$/)
  .filter((f) => !f.endsWith('.d.ts'))
  .map((f) => ({ path: relative(REPO_ROOT, f), text: readFileSync(f, 'utf8') }))

const findings = findUnreachableEnforcement({ modules, publishedNames: names, allowlist: entries })

if (findings.length === 0) {
  console.log(
    `[invention-reachability] OK — every decision-shaped exported type has reachable enforcement ` +
      `(${String(modules.length)} modules scanned).`,
  )
  process.exit(0)
}

console.log(
  `[invention-reachability] ${String(findings.length)} finding(s). A type crossed the package ` +
    `boundary while the code that acts on it did not, so a consumer can describe the decision and ` +
    `cannot apply it — which is how the same rule ends up implemented twice.`,
)
for (const f of findings) {
  const lapsed = f.allowlistExpired ? ' [allowlist entry EXPIRED — exemption lapsed]' : ''
  console.log(
    `  ${f.type} (${f.module}) — exported as a type; ${f.enforcement.join(', ')} not reachable${lapsed}`,
  )
}
console.log(
  `\nThis rule is a HEURISTIC (an exported \`…Posture|Policy|Decision|Mode|Strategy\` type plus a ` +
    `function in the same module taking it) and produces false positives. Answer one with an entry ` +
    `in ${relative(REPO_ROOT, ALLOWLIST)} — every entry needs a sunset, and an expired entry is ` +
    `ignored rather than honoured.`,
)
process.exit(0)
