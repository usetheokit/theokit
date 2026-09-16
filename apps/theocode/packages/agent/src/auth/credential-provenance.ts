import { readFileSync } from 'node:fs'

export type SourceOrigin =
  | { kind: 'env'; varName: string }
  | { kind: 'file'; path: string }
  // M37 — an OAuth session. Carries the provider name only (never a token), so the footer can say
  // "oauth (anthropic)" and the user can tell an account login apart from a pasted API key or a .env value.
  | { kind: 'oauth'; provider: string }

/**
 * Does the value OPEN and CLOSE on its own line?
 *
 * The leading quote is stripped first because it is the one that opened the value: without that,
 * `"still` reads as closed by the quote that opened it, and the scan resumes mid-value.
 */
function opensAndCloses(value: string, q: string): boolean {
  const withoutOpening = value.trimStart().startsWith(q) ? value.trimStart().slice(1) : value
  return withoutOpening.includes(q)
}

/**
 * Does this CONTINUATION line carry the closing quote?
 *
 * Deliberately does not strip, and the two predicates were one function until 2026-09-10. Stripping
 * here removes the only quote from a line that is just `"` — the conventional way to end a
 * multi-line value — so the line read as "still open" and the scan swallowed the remainder of the
 * file. Every declaration below such a value was lost, and the footer then reported `(shell)` for a
 * variable the `.env` declares.
 */
function carriesClosingQuote(line: string, q: string): boolean {
  return line.includes(q)
}

export function dotenvNames(path: string): Set<string> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return new Set()
  }

  const names = new Set<string>()
  const lines = raw.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i]!.replace(/^[ \t]+|[ \t]+$/g, '')
    i++
    const pair = linePair(trimmed)
    if (pair === undefined) continue
    i = skipMultilineValue(pair.value, lines, i)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.name)) names.add(pair.name)
  }
  return names
}

function linePair(trimmed: string): { name: string; value: string } | undefined {
  if (trimmed.length === 0 || trimmed.startsWith('#')) return undefined
  const eq = trimmed.indexOf('=')
  if (eq <= 0) return undefined
  return {
    name: trimmed
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .replace(/^[ \t]+|[ \t]+$/g, ''),
    value: trimmed.slice(eq + 1),
  }
}

function skipMultilineValue(value: string, lines: readonly string[], i: number): number {
  const withoutLeadingSpace = value.trimStart()
  const q = withoutLeadingSpace[0]
  if (q !== '"' && q !== "'" && q !== '`') return i
  if (opensAndCloses(withoutLeadingSpace, q)) return i
  let j = i
  while (j < lines.length && !carriesClosingQuote(lines[j]!, q)) j++
  return j + 1
}

export function describeSource(
  origin: SourceOrigin,
  dotenvKeys: ReadonlySet<string>,
  dotenvPath: string,
): string {
  if (origin.kind === 'oauth') return `oauth (${origin.provider})`
  if (origin.kind === 'file') return origin.path
  return dotenvKeys.has(origin.varName)
    ? `${origin.varName} (${dotenvPath})`
    : `${origin.varName} (shell)`
}
