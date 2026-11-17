/**
 * Glob matcher with bounded running time.
 *
 * picomatch (through 4.0.7, GHSA-fc5q-39xc-vjpf) and minimatch (10.2.5, GHSA-g3hv-75wg-m249) both
 * compile a glob to one backtracking RegExp, so a crafted glob or path can hold the event loop. This
 * matcher parses the glob to nodes and runs them over *sets of string positions*, so the work is
 * polynomial in the path length whatever the glob is. Supported: `*`, `**`, `?`, `[a-z]` / `[!a]`,
 * `{a,b}` and `{1..3}`, the extglobs `@() ?() *() +() !()`, and `\` escapes. Dotfiles match.
 */

type Node =
  | { t: 'lit'; c: string }
  | { t: 'one' }
  | { t: 'star' }
  | { t: 'any' }
  | { t: 'deep' }
  | { t: 'tail' }
  | { t: 'set'; neg: boolean; items: [string, string][] }
  | { t: 'group'; k: string; alts: Node[][] }

interface Cursor {
  p: string
  i: number
}

const MAX_RANGE = 1000

function parseSet(cur: Cursor): Node | undefined {
  const start = cur.i
  let i = start + 1
  let neg = false
  if (cur.p[i] === '!' || cur.p[i] === '^') {
    neg = true
    i++
  }
  const items: [string, string][] = []
  let first = true
  while (i < cur.p.length && (cur.p[i] !== ']' || first)) {
    first = false
    let lo = cur.p[i] ?? ''
    if (lo === '\\' && i + 1 < cur.p.length) lo = cur.p[++i] ?? ''
    i++
    if (cur.p[i] === '-' && i + 1 < cur.p.length && cur.p[i + 1] !== ']') {
      items.push([lo, cur.p[i + 1] ?? lo])
      i += 2
    } else {
      items.push([lo, lo])
    }
  }
  if (cur.p[i] !== ']') return undefined
  cur.i = i + 1
  return { t: 'set', neg, items }
}

function parseAlts(cur: Cursor, sep: string, close: string): Node[][] | undefined {
  const alts: Node[][] = []
  for (;;) {
    alts.push(parseSeq(cur, sep + close))
    if (cur.i >= cur.p.length) return undefined
    const c = cur.p.charAt(cur.i)
    cur.i++
    if (c === close) return alts
  }
}

function numericRange(alts: Node[][]): Node[][] | undefined {
  if (alts.length !== 1) return undefined
  const text = (alts[0] ?? []).map((n) => (n.t === 'lit' ? n.c : '\0')).join('')
  const parts = text.split('..')
  if (parts.length !== 2) return undefined
  const [a, b] = parts.map((x) => (/^-?\d+$/.test(x) ? Number(x) : NaN)) as [number, number]
  if (Number.isNaN(a) || Number.isNaN(b) || Math.abs(b - a) > MAX_RANGE) return undefined
  const out: Node[][] = []
  const step = a <= b ? 1 : -1
  for (let k = 0; k <= Math.abs(b - a); k++) {
    out.push(Array.from(String(a + k * step), (c): Node => ({ t: 'lit', c })))
  }
  return out
}

function parseBrace(cur: Cursor): Node[] {
  const start = cur.i
  cur.i++
  const alts = parseAlts(cur, ',', '}')
  if (alts === undefined) {
    cur.i = start + 1
    return [{ t: 'lit', c: '{' }]
  }
  const range = numericRange(alts)
  if (range !== undefined) return [{ t: 'group', k: '@', alts: range }]
  if (alts.length === 1) {
    const only = alts[0] ?? []
    return [{ t: 'lit', c: '{' }, ...only, { t: 'lit', c: '}' }]
  }
  return [{ t: 'group', k: '@', alts }]
}

function parseExtglob(cur: Cursor): Node | undefined {
  const start = cur.i
  const k = cur.p[start] ?? ''
  cur.i += 2
  const alts = parseAlts(cur, '|', ')')
  if (alts === undefined) {
    cur.i = start
    return undefined
  }
  return { t: 'group', k, alts }
}

function parseStars(cur: Cursor): Node {
  const atStart = cur.i === 0 || cur.p.charAt(cur.i - 1) === '/'
  let n = 0
  while (cur.p[cur.i] === '*') {
    n++
    cur.i++
  }
  const atBoundary = n > 1 && atStart
  if (atBoundary && cur.i >= cur.p.length) return { t: 'any' }
  if (atBoundary && cur.p[cur.i] === '/') {
    cur.i++
    return { t: 'deep' }
  }
  return { t: 'star' }
}

function parseAtom(cur: Cursor): Node[] {
  const c = cur.p[cur.i] ?? ''
  if (c === '*' && cur.p[cur.i + 1] !== '(') return [parseStars(cur)]
  if ('*?+@!'.includes(c) && cur.p[cur.i + 1] === '(') {
    const g = parseExtglob(cur)
    if (g !== undefined) return [g]
  }
  if (c === '{') return parseBrace(cur)
  if (c === '[') {
    const set = parseSet(cur)
    if (set !== undefined) return [set]
  }
  return [parseLiteral(cur, c)]
}

function parseLiteral(cur: Cursor, c: string): Node {
  if (c === '/' && cur.p.length === cur.i + 3 && cur.p.endsWith('/**')) {
    cur.i += 3
    return { t: 'tail' }
  }
  cur.i++
  if (c === '?') return { t: 'one' }
  if (c === '\\' && cur.i < cur.p.length) return { t: 'lit', c: cur.p.charAt(cur.i++) }
  return { t: 'lit', c }
}

function parseSeq(cur: Cursor, stop: string): Node[] {
  const out: Node[] = []
  while (cur.i < cur.p.length && !stop.includes(cur.p[cur.i] ?? '')) {
    out.push(...parseAtom(cur))
  }
  return out
}

function inSet(node: Extract<Node, { t: 'set' }>, ch: string): boolean {
  const hit = node.items.some(([lo, hi]) => ch >= lo && ch <= hi)
  return hit !== node.neg
}

/** Ends of `nodes` run from every start in `starts`. */
function run(nodes: Node[], s: string, starts: Set<number>): Set<number> {
  let cur = starts
  for (const node of nodes) {
    if (cur.size === 0) break
    cur = step(node, s, cur)
  }
  return cur
}

function alts(g: Extract<Node, { t: 'group' }>, s: string, from: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const alt of g.alts) for (const e of run(alt, s, from)) out.add(e)
  return out
}

function closure(g: Extract<Node, { t: 'group' }>, s: string, seed: Set<number>): Set<number> {
  const seen = new Set(seed)
  let frontier = seed
  while (frontier.size > 0) {
    const next = new Set<number>()
    for (const e of alts(g, s, frontier)) {
      if (!seen.has(e)) {
        seen.add(e)
        next.add(e)
      }
    }
    frontier = next
  }
  return seen
}

function negate(g: Extract<Node, { t: 'group' }>, s: string, from: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const i of from) {
    const matched = alts(g, s, new Set([i]))
    for (let j = i; j <= s.length; j++) {
      if (!matched.has(j)) out.add(j)
      if (s[j] === '/') break
    }
  }
  return out
}

function stepGroup(g: Extract<Node, { t: 'group' }>, s: string, from: Set<number>): Set<number> {
  switch (g.k) {
    case '!':
      return negate(g, s, from)
    case '?':
      return new Set([...from, ...alts(g, s, from)])
    case '*':
      return closure(g, s, from)
    case '+':
      return closure(g, s, alts(g, s, from))
    default:
      return alts(g, s, from)
  }
}

function reach(s: string, from: Set<number>, crossSlash: boolean, minAdvance = 0): Set<number> {
  const out = new Set<number>()
  for (const i of from) {
    for (let j = i; j <= s.length; j++) {
      if (j - i >= minAdvance) out.add(j)
      if (!crossSlash && s[j] === '/') break
    }
  }
  return out
}

function stepChar(node: Node, s: string, from: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const i of from) {
    if (i >= s.length) continue
    const ch = s.charAt(i)
    const ok =
      node.t === 'lit' ? ch === node.c : ch !== '/' && (node.t !== 'set' || inSet(node, ch))
    if (ok) out.add(i + 1)
  }
  return out
}

function step(node: Node, s: string, from: Set<number>): Set<number> {
  switch (node.t) {
    case 'star':
      return reach(s, from, false)
    case 'any':
      return reach(s, from, true)
    case 'deep': {
      // `**/`: zero or more whole segments.
      const out = new Set<number>()
      for (const j of reach(s, from, true)) if (from.has(j) || s[j - 1] === '/') out.add(j)
      return out
    }
    case 'tail': {
      // trailing `/**`: the directory itself or anything below it.
      const out = new Set<number>()
      for (const i of from) {
        out.add(i)
        if (s[i] === '/') for (const j of reach(s, new Set([i + 1]), true)) out.add(j)
      }
      return out
    }
    case 'group':
      return stepGroup(node, s, from)
    default:
      return stepChar(node, s, from)
  }
}

export function compileGlob(pattern: string): (path: string) => boolean {
  const nodes = parseSeq({ p: pattern, i: 0 }, '')
  return (path) => run(nodes, path, new Set([0])).has(path.length)
}
