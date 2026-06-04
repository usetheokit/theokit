#!/usr/bin/env node
/**
 * G5 T3.2 — error envelope migration codemod (0.2 -> 0.4).
 *
 * Plan: .claude/knowledge-base/plans/g5-error-envelope-cross-layer-plan.md v1.0
 * § Phase 3 / T3.2.
 *
 * Rewrites legacy class-identity checks into canonical envelope-code checks.
 * Conservative scope — only the documented migration patterns from
 * docs/migration/error-envelope-0-2-to-0-4.md. Idempotent. Dry-run by default.
 *
 * Examples:
 *
 *   err.name === 'AuthRequiredError'          ->  env.code === 'UNAUTHORIZED'
 *   err.name === 'FileTooLargeError'          ->  env.code === 'PAYLOAD_TOO_LARGE'
 *   err.name === 'RequestBodyTooLargeError'   ->  env.code === 'PAYLOAD_TOO_LARGE'
 *   err.name === 'BodyTooLargeError'          ->  env.code === 'PAYLOAD_TOO_LARGE'
 *   err.name === 'RouterConventionError'      ->  env.code === 'INTERNAL_SERVER_ERROR'
 *
 * Backward-compat is preserved: the legacy err.name check still works on the
 * unmigrated Error classes. This codemod helps consumers who want to switch
 * to envelope-aware patterns but is NOT required.
 *
 * Usage:
 *   node scripts/migrations/envelope-0-2-to-0-4.mjs <file-or-dir> [--write] [--backup]
 *
 * Flags:
 *   --write    Apply changes in-place (default: dry-run, prints diff)
 *   --backup   Write a .bak file before overwriting (only with --write)
 *
 * Exits non-zero on parse failure or unknown flag. Idempotent — safe to re-run.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import process from 'node:process'

const ENVELOPE_RENAME_MAP = new Map([
  // theokit/server ad-hoc Error classes
  ['AuthRequiredError', 'UNAUTHORIZED'],
  ['FileTooLargeError', 'PAYLOAD_TOO_LARGE'],
  ['RequestBodyTooLargeError', 'PAYLOAD_TOO_LARGE'],
  ['BodyTooLargeError', 'PAYLOAD_TOO_LARGE'],
  ['RouterConventionError', 'INTERNAL_SERVER_ERROR'],
  // @theokit/sdk Error classes
  ['AuthenticationError', 'UNAUTHORIZED'],
  ['RateLimitError', 'RATE_LIMITED'],
  ['ConfigurationError', 'PROVIDER_KEY_MISSING'],
  ['IntegrationNotConnectedError', 'PROVIDER_KEY_MISSING'],
  ['NetworkError', 'SERVICE_UNAVAILABLE'],
  ['AgentRunError', 'AGENT_RUN_ERROR'],
  ['BudgetExceededError', 'BUDGET_EXCEEDED'],
  ['CredentialPoolExhaustedError', 'CREDENTIAL_POOL_EXHAUSTED'],
  ['UnknownAgentError', 'INTERNAL_SERVER_ERROR'],
])

/**
 * Apply the codemod to a source string. Pure; returns the new source +
 * the count of rewrites.
 *
 * Two patterns are rewritten:
 *
 *   err.name === '<Class>'   ->  err.envelope.code === '<CODE>'
 *   err.name == '<Class>'    ->  err.envelope.code == '<CODE>'
 *
 * Quote style (single/double/backtick) is preserved per occurrence.
 *
 * @param {string} source
 * @returns {{source: string, count: number}}
 */
export function applyMigration(source) {
  let count = 0
  // Match `<ident>.name === 'X'` or `<ident>.name == 'X'` with any quote style.
  // <ident> may be a single identifier or a chained access (e.g., e.cause.name).
  const pattern = /(\b[A-Za-z_$][\w$.]*)\.name\s*(===|==)\s*(['"`])([A-Za-z_$][\w$]*)\3/g

  const next = source.replace(pattern, (full, ident, op, quote, className) => {
    const envCode = ENVELOPE_RENAME_MAP.get(className)
    if (envCode === undefined) {
      // Unknown class — leave the original untouched.
      return full
    }
    count += 1
    return `${ident}.envelope.code ${op} ${quote}${envCode}${quote}`
  })

  return { source: next, count }
}

/**
 * Walk a path (file OR directory) and return all .ts/.tsx/.js/.mjs files.
 * Skips node_modules, dist, build, coverage, .git directories.
 *
 * @param {string} root
 * @returns {string[]}
 */
function collectFiles(root) {
  const stat = statSync(root)
  if (stat.isFile()) {
    return [root]
  }
  const out = []
  const skip = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.theo'])
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(entry.name))) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

function printDiff(file, before, after) {
  console.log(`--- ${file}`)
  // Minimal context-line diff for readability — show only changed lines.
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const len = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < len; i++) {
    const b = beforeLines[i]
    const a = afterLines[i]
    if (b !== a) {
      if (b !== undefined) console.log(`-${i + 1}: ${b}`)
      if (a !== undefined) console.log(`+${i + 1}: ${a}`)
    }
  }
}

function parseArgs(argv) {
  const flags = { write: false, backup: false }
  const positional = []
  for (const arg of argv) {
    if (arg === '--write') flags.write = true
    else if (arg === '--backup') flags.backup = true
    else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`)
      process.exit(2)
    } else {
      positional.push(arg)
    }
  }
  return { flags, positional }
}

function processFile(file, flags) {
  const source = readFileSync(file, 'utf8')
  const { source: next, count } = applyMigration(source)
  if (count === 0) return 0
  if (flags.write) {
    if (flags.backup) writeFileSync(`${file}.bak`, source, 'utf8')
    writeFileSync(file, next, 'utf8')
    console.log(`✓ ${file} (${count} rewrites)`)
  } else {
    printDiff(file, source, next)
  }
  return count
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  if (positional.length === 0) {
    console.error('Usage: envelope-0-2-to-0-4.mjs <file-or-dir> [--write] [--backup]')
    process.exit(2)
  }
  let totalFiles = 0
  let totalRewrites = 0
  for (const root of positional) {
    for (const file of collectFiles(root)) {
      const rewrites = processFile(file, flags)
      if (rewrites > 0) {
        totalFiles += 1
        totalRewrites += rewrites
      }
    }
  }
  console.log(`\n${totalRewrites} rewrites across ${totalFiles} file(s).`)
  if (!flags.write) console.log('Run with --write to apply.')
}

// Run only when invoked directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
