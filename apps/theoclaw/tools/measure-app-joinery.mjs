#!/usr/bin/env node
/**
 * B-405 / PIECE-8: the joinery measurement, run against this app as a gate.
 *
 * Counts the non-blank, non-comment lines of every `src/**` TypeScript file of apps/theoclaw and
 * sorts each file into one category:
 *   gap       hand-written glue the framework should own
 *   presenter hand-written presentation the framework should own
 *   mixed     both, not separable
 *   app       a legitimate application concern (the default)
 * The gate objects to `gap` and `presenter` only (OBJ-5). `mixed` and `app` are reported, not failed.
 *
 * It cannot pass on an empty directory: when it resolves no source file it exits 2 and says so,
 * because zeros from a measurement that read nothing are the absence of targets, not of joinery.
 *
 * Classification reads the file, not a list of names: a file is `gap` or `presenter` when its text
 * contains a SIGNAL below, i.e. a hand-written copy of something @theokit already owns. `RULES`
 * (path patterns, first match wins) overrides the signals for a file they misjudge.
 * `joined` counts files that import the framework (@theokit/*), so the report also says how much
 * of the app is built on it. Adding a signal can turn the gate red; that is its purpose.
 *
 * Exit: 0 gap and presenter are 0; 1 either is above 0; 2 nothing resolved.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {ReadonlyArray<{ pattern: RegExp, category: 'gap' | 'presenter' | 'mixed' | 'app', reason: string }>} */
export const RULES = []

/**
 * Hand-written copies of framework surface, matched against whole file text.
 *  - SSE framing by hand: `generateAgentRoutes` (@theokit/agents/bridge) owns the chat stream.
 *  - A hand-built agent chat route: the same generator owns the POST routes of an agent.
 *  - A hand-rolled DI container: @theokit/di owns providers and `createAgentProvider` scoping.
 *  - Hand-rolled ANSI rendering or reply formatting: the presenter belongs to the framework.
 */
export const SIGNALS = [
  { category: 'gap', pattern: /text\/event-stream|`data: \$\{|'data: ' \+/, reason: 'hand-written SSE framing' },
  { category: 'gap', pattern: /\.(post|route)\(\s*['"`]\/(api\/)?chat/, reason: 'hand-built agent chat route' },
  { category: 'gap', pattern: /\bclass\s+\w*(Container|Injector)\b|\bnew Map<[^>]*Provider/, reason: 'hand-rolled DI container' },
  { category: 'presenter', pattern: /\\u001b\[|\\x1b\[/, reason: 'hand-written ANSI rendering' },
  { category: 'presenter', pattern: /function\s+(render|format)(Agent)?(Reply|Message|Transcript)\w*\(/, reason: 'hand-written reply presenter' },
]

const FRAMEWORK_IMPORT = /from\s+['"]@theokit\//

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Non-blank lines that are not comments. Block comments are tracked across lines. */
export function countCodeLines(text) {
  let inBlock = false
  let count = 0
  for (const raw of text.split('\n')) {
    let line = raw.trim()
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end < 0) continue
      inBlock = false
      line = line.slice(end + 2).trim()
    }
    while (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2)
      if (end < 0) {
        inBlock = true
        line = ''
        break
      }
      line = line.slice(end + 2).trim()
    }
    if (line === '' || line.startsWith('//')) continue
    count += 1
  }
  return count
}

function sourceFiles(dir) {
  const found = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) found.push(full)
  }
  return found
}

export function categoryOf(path, text = '', rules = RULES, signals = SIGNALS) {
  const byPath = rules.find((rule) => rule.pattern.test(path))
  if (byPath !== undefined) return byPath.category
  return signals.find((signal) => signal.pattern.test(text))?.category ?? 'app'
}

/** The measurement: `{ resolved, rows, totals }`. Pure of process state apart from reading `root`. */
export function measure(root = APP_ROOT, rules = RULES, signals = SIGNALS) {
  let files = []
  try {
    files = sourceFiles(join(root, 'src'))
  } catch {
    files = []
  }
  const rows = files.map((file) => {
    const path = relative(root, file).split(sep).join('/')
    const text = readFileSync(file, 'utf8')
    return {
      path,
      category: categoryOf(path, text, rules, signals),
      lines: countCodeLines(text),
      joined: FRAMEWORK_IMPORT.test(text),
    }
  })
  const totals = { gap: 0, presenter: 0, mixed: 0, app: 0, total: 0 }
  for (const row of rows) {
    totals[row.category] += row.lines
    totals.total += row.lines
  }
  return { resolved: rows.length, joined: rows.filter((row) => row.joined).length, rows, totals }
}

/** `{ code, report }` for a measurement. */
export function verdict(result) {
  const { gap, presenter, mixed, app, total } = result.totals
  const summary = `files: ${result.resolved}  joined: ${result.joined}  total: ${total}  gap: ${gap}  presenter: ${presenter}  mixed: ${mixed}  app: ${app}`
  if (result.resolved === 0 || total === 0) {
    return {
      code: 2,
      report: `${summary}\nresolved no source file: the zeros above are the absence of the query's targets, not the absence of joinery.`,
    }
  }
  if (gap > 0 || presenter > 0) {
    const offenders = result.rows
      .filter((row) => (row.category === 'gap' || row.category === 'presenter') && row.lines > 0)
      .map((row) => `  ${row.category} ${row.lines} ${row.path}`)
    return { code: 1, report: [summary, 'gap or presenter above 0:', ...offenders].join('\n') }
  }
  return { code: 0, report: summary }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, report } = verdict(measure())
  ;(code === 0 ? console.log : console.error)(report)
  process.exitCode = code
}
