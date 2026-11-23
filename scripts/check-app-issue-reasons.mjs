#!/usr/bin/env node
/**
 * Fail when a comment under `apps/` gives an open issue as the reason for local code and that
 * issue is closed. A reason is a reference (`#123`, `repo#123`, `owner/repo#123`, backticks allowed)
 * in a comment, in the same sentence as a cue of dependence ("until", "gap", "not yet", "copy",
 * "refused", ...). Comment lines that follow each other are read as one comment.
 *
 * A lookup that cannot be answered fails the check: a silent pass is the weakness this guards.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_REPO = 'usetheokit/theokit'
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
// A reason names what the code waits for or works around. The cue must come before the reference,
// in the same comment, within one sentence-sized window.
const CUE_WORDS =
  "until|blocked|waiting|waits|pending|gaps?|not yet|lacks?|missing|cannot|can't|refused|restated|mirrors?|copy|workaround"
const CUE = new RegExp(`\\b(?:${CUE_WORDS})\\b|\\bno\\b.{0,40}\\byet\\b`, 'i')
// `#N`, `repo#N` or `owner/repo#N`, with or without a backtick around it.
const REF = /(?:([\w.-]+)\/)?([\w.-]*)#(\d+)\b/g // eslint-disable-line sonarjs/slow-regex -- bounded by one comment
const WINDOW = 160

/** @param {string} owner @param {string} name */
function repoOf(owner, name) {
  if (owner && name) return `${owner}/${name}`
  if (name) return `usetheokit/${name}`
  return DEFAULT_REPO
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walk(path))
    else if (EXTENSIONS.test(name)) out.push(path)
  }
  return out
}

/** Comment blocks of `text`: runs of consecutive comment lines, with the line each starts on. */
function commentBlocks(text) {
  const blocks = []
  let current = null
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    const whole = /^(\/\/|\/\*|\*)/.test(trimmed)
    const tail = whole ? -1 : line.search(/\s\/\/\s/)
    if (!whole && tail < 0) {
      current = null
      return
    }
    const body = whole ? trimmed : line.slice(tail)
    if (current && whole) {
      current.lines.push({ body, line: index + 1 })
      return
    }
    current = { lines: [{ body, line: index + 1 }] }
    blocks.push(current)
    if (!whole) current = null
  })
  return blocks
}

/** Every reference in a comment that follows a cue of dependence, within one sentence-sized window. */
export function findReasons(text, file = '') {
  const found = []
  for (const block of commentBlocks(text)) {
    let joined = ''
    const starts = []
    for (const { body, line } of block.lines) {
      starts.push([joined.length, line])
      joined += `${body} `
    }
    for (const m of joined.matchAll(REF)) {
      const before = joined.slice(Math.max(0, m.index - WINDOW), m.index)
      const sentence = before.slice(before.lastIndexOf('. ') + 1)
      if (!CUE.test(sentence)) continue
      const line = starts.filter(([at]) => at <= m.index).pop()[1]
      found.push({ file, line, repo: repoOf(m[1], m[2]), issue: Number(m[3]) })
    }
  }
  return found
}

export function collectReasons(root) {
  const appsDir = join(root, 'apps')
  return walk(appsDir).flatMap((path) =>
    findReasons(readFileSync(path, 'utf8'), relative(root, path)),
  )
}

/** @returns {Promise<'open' | 'closed'>} */
export async function githubState(
  repo,
  issue,
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'check-app-issue-reasons' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${issue}`, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (body.state !== 'open' && body.state !== 'closed') throw new Error('no state in the response')
  return body.state
}

/** @returns {Promise<string[]>} one problem line per closed or unverifiable reason */
export async function checkReasons(reasons, lookup = githubState) {
  const problems = []
  const cache = new Map()
  for (const r of reasons) {
    const key = `${r.repo}#${r.issue}`
    if (!cache.has(key)) {
      cache.set(
        key,
        lookup(r.repo, r.issue).then(
          (state) => ({ state }),
          (error) => ({ error: error instanceof Error ? error.message : String(error) }),
        ),
      )
    }
    const result = await cache.get(key)
    if (result.error) {
      problems.push(`${r.file}:${r.line}: cannot verify ${key} (${result.error}); set GITHUB_TOKEN`)
    } else if (result.state === 'closed') {
      problems.push(
        `${r.file}:${r.line}: ${key} is closed; correct the comment or remove the code it guards`,
      )
    }
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const reasons = collectReasons(root)
  const problems = await checkReasons(reasons)
  for (const p of problems) console.error(p)
  console.log(`${reasons.length} issue reason(s) under apps/, ${problems.length} problem(s)`)
  process.exit(problems.length === 0 ? 0 : 1)
}
