#!/usr/bin/env node
/**
 * Documentation guard — a `path/to/file.ts:42` citation still points at something.
 *
 * ## Why a gate and not a review
 *
 * Code that points at the wrong place breaks. A document that points at the wrong place does not:
 * it keeps rendering, and the cost lands on whoever went to check. A sweep of this repository found
 * 354 citations naming a file that no longer exists and 24 naming a line past the end of the file
 * it names — none of which failed anything (usetheokit/theokit#193).
 *
 * ## What it checks, and what it deliberately does not
 *
 * For every citation written as an explicit path (`packages/theo/src/foo.ts:175`), BOTH must hold:
 *
 *   1. the path resolves on disk — from the repo root, or relative to the document;
 *   2. the line is within the file.
 *
 * Checking existence alone would make `file.ts:1` the path of least resistance — a citation that
 * cites without pointing, and a gate that approves it.
 *
 * It does NOT check what the line SAYS. That would need a semantic anchor and would fail on every
 * legitimate refactor. The target is the citation that rotted, not the one that moved a line.
 *
 * It does NOT resolve BARE names (`chat.ts:494`, no directory). Resolving those needs a
 * basename index, and a basename shared by several files makes the answer a guess — the same
 * instrument that reported 945 rotten citations before indexing reported 354 after, with 143 left
 * ambiguous. A gate that guesses reports numbers nobody can act on, so bare citations are counted
 * and reported, never failed.
 *
 * ## Scope: living documents, not the historical record
 *
 * CHANGELOG files are excluded by design. A changelog describes the past, and a citation into code
 * as it stood at v0.31 SHOULD stop resolving — that is the record being accurate, not rotten.
 * The same applies to the release notes under `.changeset/`. Everything a reader treats as current
 * — README, ROADMAP, CONTRIBUTING, MIGRATION, SECURITY, `docs/**` — is in scope.
 *
 * Usage:
 *   node scripts/check-doc-citations.mjs            # gate: exits 1 on a rotten citation
 *   node scripts/check-doc-citations.mjs --report   # inventory only, always exits 0
 *
 * @internal
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

/** Extensions a citation may name. Kept narrow — `foo.md:12` is a citation, `v1.2:30` is not. */
const CITED_EXTENSIONS =
  'ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|mdx|yml|yaml|go|py|rs|sh|sql|toml|css'

/**
 * `path/to/file.ext:LINE`, with the path bounded so surrounding prose, backticks and parentheses
 * do not become part of it.
 */
const CITATION = new RegExp(`([A-Za-z0-9_./@-]+\\.(?:${CITED_EXTENSIONS})):(\\d+)`, 'g')

/** Directories never walked — third-party, generated, or the study zone. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.theokit',
  'coverage',
  'knowledge-base',
  '.changeset',
  'templates',
  'test-results',
  'playwright-report',
])

/** A file is a changelog — the historical record, out of scope (see § Scope). */
export function isHistoricalRecord(relPath) {
  return /(^|\/)CHANGELOG[^/]*\.md$/i.test(relPath)
}

/**
 * Every citation in `text`, with the 1-based line it was written on.
 *
 * @returns {{ raw: string, path: string, line: number, docLine: number }[]}
 */
export function extractCitations(text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(CITATION)) {
      out.push({ raw: m[0], path: m[1], line: Number(m[2]), docLine: i + 1 })
    }
  }
  return out
}

/** A citation with no directory separator cannot be resolved without guessing (see § What). */
export function isBareName(citationPath) {
  return !citationPath.includes('/')
}

/**
 * Classify one citation against the filesystem.
 *
 * @returns {'ok' | 'bare' | 'missing_file' | 'line_past_eof'}
 */
export function classifyCitation(citation, docPath, repoRoot, fs = { existsSync, readFileSync }) {
  if (isBareName(citation.path)) return 'bare'
  const candidates = [resolve(repoRoot, citation.path), resolve(dirname(docPath), citation.path)]
  const found = candidates.find((c) => fs.existsSync(c) && !isDirectory(c))
  if (found === undefined) return 'missing_file'
  const lineCount = fs.readFileSync(found, 'utf-8').split('\n').length
  return citation.line > lineCount ? 'line_past_eof' : 'ok'
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Every in-scope markdown file under `root`. */
export function collectDocs(root, dir = root, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectDocs(root, full, acc)
    } else if (entry.name.endsWith('.md') && !isHistoricalRecord(relative(root, full))) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * Walk every in-scope document and classify every citation in it.
 *
 * @returns {{ ok: number, bare: number, rotten: { doc: string, citation: object, verdict: string }[] }}
 */
export function scanDocs(root) {
  const rotten = []
  let ok = 0
  let bare = 0
  for (const doc of collectDocs(root)) {
    for (const citation of extractCitations(readFileSync(doc, 'utf-8'))) {
      const verdict = classifyCitation(citation, doc, root)
      if (verdict === 'ok') ok++
      else if (verdict === 'bare') bare++
      else rotten.push({ doc: relative(root, doc), citation, verdict })
    }
  }
  return { ok, bare, rotten }
}

function reportRotten(rotten, total) {
  console.error(`Documentation citations: ${rotten.length} rotten of ${total}\n`)
  for (const r of rotten) {
    const why =
      r.verdict === 'missing_file' ? 'file does not exist' : 'line is past the end of the file'
    console.error(`  ${r.doc}:${r.citation.docLine} -> ${r.citation.raw}   ${why}`)
  }
  console.error('')
}

function main() {
  const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const { ok, bare, rotten } = scanDocs(root)
  if (rotten.length > 0) reportRotten(rotten, ok + bare + rotten.length)
  console.error(
    `${ok} resolve, ${bare} bare (not resolvable without guessing), ${rotten.length} rotten`,
  )
  if (rotten.length > 0 && !process.argv.includes('--report')) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main()
}
