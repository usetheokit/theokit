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

import { execFileSync } from 'node:child_process'
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
 * The maintenance registry, out of scope for a different reason than the changelog.
 *
 * `BACKLOG.md` is not versioned by this repository — it is a maintainer's working file — and it
 * spans the ECOSYSTEM rather than this repo: an item about `theokit-sdk` cites
 * `packages/sdk/src/...`, an item about the agents bridge cites `bridge/...`. Those paths are
 * correct where the item points and unresolvable here, by construction.
 *
 * Measured 2026-09-15: 43 of this checker's 43 rotten citations came from this one file, and every
 * one of them named a sibling repository. Reporting them says nothing about this repository's docs
 * and hides the number that does — 1297 citations resolve.
 */
export function isUnversionedRegistry(relPath) {
  return /(^|\/)BACKLOG\.md$/i.test(relPath)
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

/**
 * #832 — `ADR-NNNN` references, which this gate did not look at.
 *
 * `README.md` justified the most consequential API decision in `@theokit/agents` — agent authoring is
 * builder-only — by citing `ADR-0043`. `docs/adr/` holds four documents and none is 0043: the internal
 * decision trail was deliberately removed from the published tree (`1555f4ff5`), and the citation
 * pointing INTO it was not updated with it. A `grep -c "ADR"` over this script returned 0, so the one
 * gate whose job is citations could not see it.
 *
 * Nothing breaks at runtime. What breaks is the ability to verify a documented decision, which is the
 * entire purpose of citing one — and in the document a new consumer reads first.
 */
const ADR_CITATION = /\bADR-(\d{4})\b/g

/** Every `ADR-NNNN` in a document, with the line it sits on. */
export function extractAdrCitations(text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(ADR_CITATION)) {
      out.push({ raw: m[0], id: m[1], docLine: i + 1 })
    }
  }
  return out
}

/**
 * Does the cited decision exist?
 *
 * Matched by NUMBER PREFIX, because `docs/adr/` names files `NNNN-slug.md` and the slug is not part of
 * the citation. Comparing whole names would report every real reference as missing.
 *
 * @returns {'ok' | 'missing_adr'}
 */
export function classifyAdrCitation(citation, repoRoot, fs = { existsSync, readdirSync }) {
  const dir = resolve(repoRoot, 'docs', 'adr')
  if (!fs.existsSync(dir)) return 'missing_adr'
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return 'missing_adr'
  }
  return entries.some((name) => name.startsWith(`${citation.id}-`)) ? 'ok' : 'missing_adr'
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

/**
 * The documents git actually tracks, or `null` where that cannot be answered.
 *
 * #832 — the walker reads the FILESYSTEM, so anything sitting in a working tree is scanned whether or
 * not it belongs to the repository. Measured 2026-09-17: 37 rotten citations, and **33 of them lived
 * in `reference-compare-output/`** — a git-ignored artifact another task had left behind. The four
 * that were the repository's were buried under them.
 *
 * Both directions are wrong. A gate that fires on somebody's scratch directory is a gate people turn
 * off, and a citation in an untracked file is not a claim this repository makes.
 *
 * `git ls-files` rather than a new entry in `SKIP_DIRS`: a hardcoded name fixes this directory and
 * loses to the next one, while git already holds the answer and is the same rule the rest of the
 * ecosystem uses — if git versions it, it is the repository's.
 *
 * `null` when git cannot answer (a tarball, a non-repository), and the caller then walks as before.
 * Refusing to run there would make the gate unusable exactly where it is cheapest to run.
 */
function trackedDocs(root) {
  try {
    // Absolute, because `sonarjs/no-os-command-from-path` is right for a gate that CI runs: resolving
    // `git` through `PATH` lets whatever is earliest on it decide what runs. `GIT` is overridable for a
    // machine that installs it elsewhere, and an unreadable one falls through to the walk below.
    const git = process.env.GIT ?? '/usr/bin/git'
    const out = execFileSync(git, ['-C', root, 'ls-files', '-z', '*.md'], { encoding: 'utf-8' })
    const files = out.split('\0').filter(Boolean)
    return files.length > 0 ? new Set(files.map((f) => resolve(root, f))) : null
  } catch {
    return null
  }
}

/** Every in-scope markdown file under `root`. */
export function collectDocs(root, dir = root, acc = [], tracked = trackedDocs(root)) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectDocs(root, full, acc, tracked)
    } else if (
      entry.name.endsWith('.md') &&
      !isHistoricalRecord(relative(root, full)) &&
      !isUnversionedRegistry(relative(root, full))
    ) {
      if (tracked === null || tracked.has(full)) acc.push(full)
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
    // #832 — ADR references, scanned in the same walk. A second pass over the same files would be
    // a second list of documents to keep in step, and the first one to drift silently.
    for (const adr of extractAdrCitations(readFileSync(doc, 'utf-8'))) {
      if (classifyAdrCitation(adr, root) === 'ok') ok++
      else rotten.push({ doc: relative(root, doc), citation: adr, verdict: 'missing_adr' })
    }
  }
  return { ok, bare, rotten }
}

/** What each verdict means to a reader. A table rather than nested ternaries — sonarjs is right that
 *  a third branch is where those stop being readable, and a fourth verdict now costs one line. */
const WHY = {
  missing_adr: 'no such decision in docs/adr/',
  missing_file: 'file does not exist',
  line_past_eof: 'line is past the end of the file',
}

function reportRotten(rotten, total) {
  console.error(`Documentation citations: ${rotten.length} rotten of ${total}\n`)
  for (const r of rotten) {
    const why = WHY[r.verdict] ?? r.verdict
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
