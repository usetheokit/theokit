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
 * Classification is the `RULES` table below, first match wins, matched on the path relative to the
 * app root. A file that is glue is added to it, and the gate then fails until the glue is removed.
 *
 * Exit: 0 gap and presenter are 0; 1 either is above 0; 2 nothing resolved.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {ReadonlyArray<{ pattern: RegExp, category: 'gap' | 'presenter' | 'mixed' | 'app', reason: string }>} */
export const RULES = []

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

export function categoryOf(path, rules = RULES) {
  return rules.find((rule) => rule.pattern.test(path))?.category ?? 'app'
}

/** The measurement: `{ resolved, rows, totals }`. Pure of process state apart from reading `root`. */
export function measure(root = APP_ROOT, rules = RULES) {
  let files = []
  try {
    files = sourceFiles(join(root, 'src'))
  } catch {
    files = []
  }
  const rows = files.map((file) => {
    const path = relative(root, file).split(sep).join('/')
    return { path, category: categoryOf(path, rules), lines: countCodeLines(readFileSync(file, 'utf8')) }
  })
  const totals = { gap: 0, presenter: 0, mixed: 0, app: 0, total: 0 }
  for (const row of rows) {
    totals[row.category] += row.lines
    totals.total += row.lines
  }
  return { resolved: rows.length, rows, totals }
}

/** `{ code, report }` for a measurement. */
export function verdict(result) {
  const { gap, presenter, mixed, app, total } = result.totals
  const summary = `files: ${result.resolved}  total: ${total}  gap: ${gap}  presenter: ${presenter}  mixed: ${mixed}  app: ${app}`
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
