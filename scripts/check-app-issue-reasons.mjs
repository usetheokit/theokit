#!/usr/bin/env node
/**
 * Fail when a comment under `apps/` gives an open issue as the reason for local code and that
 * issue is closed. A reason comment says so in one of these forms, with the issue next to it:
 *
 *     until #123            blocked by #123      waiting on #123      pending #123
 *     until owner/repo#123  (an issue in a sibling repository)
 *
 * Bare `#123` mentions that record history (a fix, a measurement) are not reasons and are ignored.
 * A lookup that cannot be answered fails the check: a silent pass is the weakness this guards.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_REPO = 'usetheokit/theokit'
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
const PHRASE = 'until|blocked by|blocked on|waiting on|waits on|pending'
const REF = '(?:[\\w.-]+/[\\w.-]+)?#\\d+'
const REASON = new RegExp(`\\b(?:${PHRASE})\\s+(?:the\\s+)?(${REF})`, 'gi')

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

/** Every reason reference in the comment lines of `text`. */
export function findReasons(text, file = '') {
  const found = []
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    const isComment = /^(\/\/|\/\*|\*)/.test(trimmed) || /\s\/\/\s/.test(line)
    if (!isComment) return
    for (const match of line.matchAll(REASON)) {
      const ref = match[1]
      const hash = ref.indexOf('#')
      found.push({
        file,
        line: index + 1,
        repo: hash > 0 ? ref.slice(0, hash) : DEFAULT_REPO,
        issue: Number(ref.slice(hash + 1)),
      })
    }
  })
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
