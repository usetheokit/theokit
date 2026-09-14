/**
 * B-066 — the readers behind `scripts/check-env-verdicts.mjs`, separated so they can be tested.
 *
 * Parsimony ladder (`rules/parsimony-ladder.md`), walked before writing:
 *
 *   1. Does this need to exist? YES — FR-005 needs a two-way comparison and nothing here does it.
 *   2. Stdlib? YES, entirely — `node:fs` and `node:path`. No dependency is added.
 *   3. Native feature? A regex over source text, not a TypeScript program. See below.
 *   5. One line? No, but every function here is one responsibility and under 40 lines.
 *
 * ## Why a regex and not the TypeScript compiler
 *
 * A type-aware pass (ts-morph, the TS compiler API) would resolve imported constants and template
 * names too. It costs a dependency, a build step, and minutes of CI, to cover ZERO cases measured in
 * this repository — the one indirection that exists resolves inside its own file.
 *
 * The honest cost of that choice is a known blind spot, and ADR-2 pays for it: an indirection this
 * cannot resolve is reported as UNRESOLVED and FAILS the gate. It is never skipped. A gate whose
 * blind spot is silent stops being a gate the first time somebody writes past it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** `process.env.NAME` — the dotted form. */
const DOTTED = /process\.env\.(\w+)/g

/**
 * `process.env[ ... ]` — whatever is between the brackets, classified in CODE rather than by
 * lookahead.
 *
 * The first version used three overlapping regexes with negative lookaheads doing the
 * classification, and `sonarjs/slow-regex` was right to refuse it: nested quantifiers behind a
 * lookahead backtrack super-linearly, and this runs over every source file in the package. One
 * capture plus three `if`s is both linear and legible — the classification was always code's job.
 */
const BRACKET = /process\.env\[([^\]]*)\]/g

/** `const IDENT = 'VALUE'`, with or without `export`. */
const CONST_DECL = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g

/** A bracket body that is a quoted literal: `process.env['NAME']`. */
const QUOTED = /^\s*['"](\w+)['"]\s*$/

/** A bracket body that is a bare identifier: `process.env[NAME]`. */
const IDENTIFIER = /^\s*([A-Za-z_$][\w$]*)\s*$/

function sourceFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(path)
    }
  }
  walk(root)
  return out.sort()
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * Every environment variable the tree reads, plus the reads it could not resolve.
 *
 * An unreadable file RAISES rather than contributing nothing. Reporting "0 reads found" for a file
 * nobody could open is indistinguishable from a clean tree, which is the swallowed-error shape
 * `rules/error-handling.md` § 2 forbids.
 */
/**
 * Every environment read in ONE file, classified.
 *
 * Split from `scanEnvReads` because they answer different questions — "what does this file read?"
 * and "what does the tree read?" — and because the combined function reached a cognitive complexity
 * of 20 against a limit of 15. The limit was right: walking a directory and classifying a bracket
 * body have nothing to do with each other, and reading them interleaved is what made the combined
 * version hard to follow.
 */
function scanOneFile(text, where, names, unresolved) {
  const consts = new Map()
  for (const m of text.matchAll(CONST_DECL)) consts.set(m[1], m[2])

  for (const m of text.matchAll(DOTTED)) names.add(m[1])

  for (const m of text.matchAll(BRACKET)) {
    const body = m[1]
    const at = `${where}:${lineOf(text, m.index)}`

    const quoted = QUOTED.exec(body)
    if (quoted) {
      names.add(quoted[1])
      continue
    }

    const ident = IDENTIFIER.exec(body)
    if (!ident) {
      // ADR-2: never a skip. A blind spot that passes silently is how a gate stops being one.
      unresolved.push(`${at} — process.env[${body.trim()}] is not a literal this gate can resolve`)
      continue
    }

    const value = consts.get(ident[1])
    if (value === undefined) {
      unresolved.push(`${at} — process.env[${ident[1]}] resolves to no const in this file`)
    } else {
      names.add(value)
    }
  }
}

/**
 * Every environment variable the tree reads, plus the reads it could not resolve.
 *
 * An unreadable file RAISES rather than contributing nothing. Reporting "0 reads found" for a file
 * nobody could open is indistinguishable from a clean tree, which is the swallowed-error shape
 * `rules/error-handling.md` § 2 forbids.
 */
export function scanEnvReads(root) {
  const names = new Set()
  const unresolved = []

  for (const file of sourceFiles(root)) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (cause) {
      throw new Error(`cannot read ${file}: the scan cannot report a clean tree it did not see`, {
        cause,
      })
    }
    scanOneFile(text, relative(root, file), names, unresolved)
  }

  return { names: [...names].sort(), unresolved }
}

/** The two-way comparison. Neither direction of drift is silent (FR-005). */
export function compareAgainstList(read, declared) {
  const readSet = new Set(read)
  const declaredSet = new Set(declared)
  const readButUndeclared = [...readSet].filter((n) => !declaredSet.has(n)).sort()
  const declaredButUnread = [...declaredSet].filter((n) => !readSet.has(n)).sort()
  return {
    ok: readButUndeclared.length === 0 && declaredButUnread.length === 0,
    readButUndeclared,
    declaredButUnread,
  }
}

const SECTION = '## Environment variables'

/**
 * The declared list, read from the README's table.
 *
 * An ABSENT section raises; it does not return `[]`. Collapsing the two would make deleting the
 * whole section the cheapest way to pass the gate.
 */
export function readDeclaredList(readmePath) {
  const text = readFileSync(readmePath, 'utf8')
  const start = text.indexOf(SECTION)
  if (start === -1) {
    throw new Error(
      `${readmePath}: the '${SECTION}' section is missing — an absent list is not an empty one`,
    )
  }
  const rest = text.slice(start + SECTION.length)
  const end = rest.search(/^## /m)
  const body = end === -1 ? rest : rest.slice(0, end)
  const names = []
  for (const m of body.matchAll(/^\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|/gm)) names.push(m[1])
  return names
}
