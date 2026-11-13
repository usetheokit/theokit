/**
 * Shared rules for a parity ledger: rows of a reference product's capabilities, each either backed by
 * a named test that exists and runs, or carrying a reason. Dependency-free on purpose.
 * The comment and string scan is ported from `apps/theoclaw/tools/check-parity-ledger.mjs`.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const HUMAN_DECLARER = /^human\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Thrown when an evidence path leaves the repository root or is not an allowed file. */
export class ParityEvidencePathError extends Error {
  constructor(file, reason) {
    super(`evidence path ${JSON.stringify(file)} ${reason}`)
    this.name = 'ParityEvidencePathError'
    this.file = file
  }
}

/** Index just past the comment opening at `i`: the end of the line, or past the closing star-slash. */
function commentEnd(text, i) {
  const end = text[i + 1] === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2) + 2
  return end > i ? end : text.length
}

/** Index just past the string literal whose opening quote is at `i`; a backslash escapes one character. */
function stringEnd(text, i) {
  let j = i + 1
  while (j < text.length && text[j] !== text[i]) j += text[j] === '\\' ? 2 : 1
  return j + 1
}

/** True when the `(` at `i` opens a `.skip(...)` or `.todo(...)` call. */
const opensNotRunCall = (text, i) =>
  /\.\s*(?:skip|todo)\s*$/.test(text.slice(Math.max(0, i - 12), i))

/**
 * `text` with every comment, and every argument list of a `.skip(...)` or `.todo(...)` call, turned
 * into spaces; newlines are kept. Strings are skipped whole. A regex literal holding a quote can
 * desynchronise the scan: this is a tokenizer, not a parser.
 */
function runnableCode(text, blankStrings = false) {
  const out = [...text]
  const blank = (from, to) => {
    for (let j = from; j < to; j++) if (out[j] !== '\n') out[j] = ' '
  }
  let depth = 0
  let notRunAt = -1
  let notRunDepth = -1
  let i = 0
  while (i < text.length) {
    const char = text[i]
    let next = i + 1
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      next = commentEnd(text, i)
      blank(i, next)
    } else if (char === "'" || char === '"' || char === '`') {
      next = stringEnd(text, i)
      if (blankStrings) blank(i + 1, next - 1)
    } else if (char === '(') {
      if (notRunAt < 0 && opensNotRunCall(text, i)) [notRunAt, notRunDepth] = [i, depth]
      depth++
    } else if (char === ')' && --depth === notRunDepth) {
      blank(notRunAt, next)
      notRunAt = -1
    }
    i = next
  }
  return out.join('')
}

/** True only when `source` has a runnable it()/test() call titled `name`: not in a comment, not .skip/.todo. */
export function declaresActiveTest(source, name) {
  if (typeof name !== 'string' || name.trim() === '') return false
  // Strings are blanked so a call written inside a string literal is not found; the title is then
  // read from the original text at the position of the opening quote.
  const code = runnableCode(source, true)
  const call = /(?<![\w$.])(?:it|test)\s*\(\s*(['"`])/g
  for (const match of code.matchAll(call)) {
    const quote = match.index + match[0].length - 1
    const end = stringEnd(source, quote)
    if (source.slice(quote + 1, end - 1) === name) return true
  }
  return false
}

/** Outside when the relative path is empty, absolute, or its FIRST segment is exactly `..`. */
function leavesRoot(root, target) {
  const rel = relative(root, target)
  return rel === '' || isAbsolute(rel) || rel.split(sep)[0] === '..'
}

/** Resolves `file` under repoRoot; throws a typed error when it escapes the root or does not match `allowed`. */
export function resolveEvidenceFile(repoRoot, file, { allowed } = {}) {
  if (typeof file !== 'string' || file === '')
    throw new ParityEvidencePathError(String(file), 'is not a path')
  const target = resolve(repoRoot, file)
  if (leavesRoot(repoRoot, target))
    throw new ParityEvidencePathError(file, 'leaves the repository root')
  let real = target
  try {
    real = realpathSync(target)
  } catch {
    // A missing file is the caller's `read` to report; the lexical check above already held.
  }
  if (real !== target && leavesRoot(realpathSync(repoRoot), real)) {
    throw new ParityEvidencePathError(file, 'resolves outside the repository root')
  }
  const rel = relative(repoRoot, target).split(sep).join('/')
  if (allowed instanceof RegExp && !allowed.test(rel)) {
    throw new ParityEvidencePathError(file, 'is not an allowed evidence file')
  }
  return target
}

/** True for a real calendar date written `YYYY-MM-DD`. */
function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

function judgeShipped(id, row, { read, repoRoot, allowedEvidence }) {
  const evidence = row.evidence
  if (typeof evidence?.file !== 'string' || typeof evidence.test !== 'string') {
    return [`${id}: shipped row needs evidence { file, test }`]
  }
  let source
  try {
    source = read(resolveEvidenceFile(repoRoot, evidence.file, { allowed: allowedEvidence }))
  } catch (error) {
    if (error instanceof ParityEvidencePathError) return [`${id}: ${error.message}`]
    return [`${id}: evidence file ${evidence.file} is missing or unreadable`]
  }
  if (!declaresActiveTest(source, evidence.test)) {
    return [`${id}: ${evidence.file} has no active test titled "${evidence.test}"`]
  }
  return []
}

function judgeReason(id, row, minReasonWords) {
  const words =
    typeof row.reason === 'string' ? row.reason.trim().split(/\s+/).filter(Boolean).length : 0
  return words < minReasonWords
    ? [`${id}: reason has ${words} words, at least ${minReasonWords} required`]
    : []
}

function judgeDeclarer(id, row, today) {
  const out = []
  if (typeof row.declared_by !== 'string' || !HUMAN_DECLARER.test(row.declared_by)) {
    out.push(`${id}: declared_by must be human/<name>`)
  }
  if (!isIsoDate(row.declared_on) || (today !== undefined && row.declared_on > today)) {
    out.push(`${id}: declared_on must be a real date no later than today`)
  }
  return out
}

/**
 * Generic row rules: unique ids, a known status, shipped rows with existing evidence that declares an
 * active test, non-shipped rows with a reason of at least `minReasonWords`, optional dated human declarers
 * (`row.declared_by` / `row.declared_on`, checked on non-shipped rows when `today` is given).
 * Returns `{ counts, violations }`.
 */
export function checkLedgerRows(rows, options) {
  const { statuses, shippedStatus = 'shipped', today, minReasonWords = 8 } = options
  const { read = (path) => readFileSync(path, 'utf8') } = options
  const ctx = { read, repoRoot: options.repoRoot, allowedEvidence: options.allowedEvidence }
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]))
  const violations = []
  const seen = new Set()
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : JSON.stringify(row?.id)
    if (seen.has(id)) violations.push(`${id}: duplicate id`)
    seen.add(id)
    if (!statuses.includes(row?.status)) {
      violations.push(`${id}: unknown status ${JSON.stringify(row?.status)}`)
      continue
    }
    counts[row.status]++
    if (row.status === shippedStatus) {
      violations.push(...judgeShipped(id, row, ctx))
      continue
    }
    violations.push(...judgeReason(id, row, minReasonWords))
    if (today !== undefined) violations.push(...judgeDeclarer(id, row, today))
  }
  return { counts, violations }
}
