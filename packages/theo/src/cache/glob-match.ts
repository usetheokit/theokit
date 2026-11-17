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
  | { t: 'set'; neg: boolean; items: [string, string][]; classes: string[] }
  | { t: 'star1' }
  | { t: 'group'; k: string; alts: Node[][] }

interface Cursor {
  p: string
  i: number
}

const MAX_RANGE = 1000

const POSIX: Record<string, RegExp> = {
  alpha: /[A-Za-z]/,
  digit: /\d/,
  alnum: /[A-Za-z0-9]/,
  upper: /[A-Z]/,
  lower: /[a-z]/,
  space: /\s/,
  blank: /[ \t]/,
  punct: /[!-/:-@[-`{-~]/,
  xdigit: /[0-9A-Fa-f]/,
  word: /\w/,
}

/** One member of a bracket expression, from `i`: a `[:class:]`, a range or a single character. */
function parseSetMember(
  p: string,
  i: number,
  set: { items: [string, string][]; classes: string[] },
): number {
  const posix = /^\[:([a-z]+):\]/.exec(p.slice(i, i + 12))
  if (posix !== null && Object.hasOwn(POSIX, posix[1])) {
    set.classes.push(posix[1])
    return i + posix[0].length
  }
  let lo = p.charAt(i)
  if (lo === '\\' && i + 1 < p.length) lo = p.charAt(++i)
  i++
  if (p.charAt(i) === '-' && i + 1 < p.length && p.charAt(i + 1) !== ']') {
    set.items.push([lo, p.charAt(i + 1)])
    return i + 2
  }
  set.items.push([lo, lo])
  return i
}

function parseSet(cur: Cursor): Node | undefined {
  let i = cur.i + 1
  const neg = cur.p.charAt(i) === '!' || cur.p.charAt(i) === '^'
  if (neg) i++
  const set = { items: [] as [string, string][], classes: [] as string[] }
  let first = true
  while (i < cur.p.length && (cur.p.charAt(i) !== ']' || first)) {
    first = false
    i = parseSetMember(cur.p, i, set)
  }
  if (cur.p.charAt(i) !== ']') return undefined
  cur.i = i + 1
  return { t: 'set', neg, ...set }
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

function rangeEnds(parts: string[]): [number, number, boolean] | undefined {
  const x = parts[0] ?? ''
  const y = parts[1] ?? ''
  if (/^-?\d+$/.test(x) && /^-?\d+$/.test(y)) return [Number(x), Number(y), false]
  if (/^[A-Za-z]$/.test(x) && /^[A-Za-z]$/.test(y)) return [x.charCodeAt(0), y.charCodeAt(0), true]
  return undefined
}

/** `{1..3}` and `{a..c}` as alternatives. */
function numericRange(alts: Node[][]): Node[][] | undefined {
  if (alts.length !== 1) return undefined
  const text = (alts[0] ?? []).map((n) => (n.t === 'lit' ? n.c : '\0')).join('')
  const parts = text.split('..')
  const ends = parts.length === 2 ? rangeEnds(parts) : undefined
  if (ends === undefined || Math.abs(ends[1] - ends[0]) > MAX_RANGE) return undefined
  const [a, b, letters] = ends
  const step = a <= b ? 1 : -1
  const out: Node[][] = []
  for (let k = 0; k <= Math.abs(b - a); k++) {
    const v = a + k * step
    out.push(
      Array.from(letters ? String.fromCharCode(v) : String(v), (c): Node => ({ t: 'lit', c })),
    )
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
  if (n === 1 && atStart && cur.i >= cur.p.length && cur.i > 1) return { t: 'star1' }
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
  const hit =
    node.items.some(([lo, hi]) => ch >= lo && ch <= hi) ||
    node.classes.some((name) => POSIX[name].test(ch))
  return hit !== node.neg
}

interface Ctx {
  s: string
  /** Ends of a node list from one start, so nested groups are evaluated once per (list, start). */
  memo: Map<Node[], Map<number, Set<number>>>
}

/** Ends of `nodes` run from every start in `starts`. */
function run(nodes: Node[], ctx: Ctx, starts: Set<number>): Set<number> {
  let cur = starts
  for (const node of nodes) {
    if (cur.size === 0) break
    cur = step(node, ctx, cur)
  }
  return cur
}

function runFrom(nodes: Node[], ctx: Ctx, from: Set<number>): Set<number> {
  const out = new Set<number>()
  let byStart = ctx.memo.get(nodes)
  if (byStart === undefined) {
    byStart = new Map()
    ctx.memo.set(nodes, byStart)
  }
  for (const i of from) {
    let ends = byStart.get(i)
    if (ends === undefined) {
      ends = run(nodes, ctx, new Set([i]))
      byStart.set(i, ends)
    }
    for (const e of ends) out.add(e)
  }
  return out
}

function alts(g: Extract<Node, { t: 'group' }>, ctx: Ctx, from: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const alt of g.alts) for (const e of runFrom(alt, ctx, from)) out.add(e)
  return out
}

function closure(g: Extract<Node, { t: 'group' }>, ctx: Ctx, seed: Set<number>): Set<number> {
  const seen = new Set(seed)
  let frontier = seed
  while (frontier.size > 0) {
    const next = new Set<number>()
    for (const e of alts(g, ctx, frontier)) {
      if (!seen.has(e)) {
        seen.add(e)
        next.add(e)
      }
    }
    frontier = next
  }
  return seen
}

function negate(g: Extract<Node, { t: 'group' }>, ctx: Ctx, from: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const i of from) {
    const matched = alts(g, ctx, new Set([i]))
    for (let j = i; j <= ctx.s.length; j++) {
      if (!matched.has(j)) out.add(j)
      if (ctx.s[j] === '/') break
    }
  }
  return out
}

function stepGroup(g: Extract<Node, { t: 'group' }>, ctx: Ctx, from: Set<number>): Set<number> {
  switch (g.k) {
    case '!':
      return negate(g, ctx, from)
    case '?':
      return new Set([...from, ...alts(g, ctx, from)])
    case '*':
      return closure(g, ctx, from)
    case '+':
      return closure(g, ctx, alts(g, ctx, from))
    default:
      return alts(g, ctx, from)
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

function stepChar(node: Node, ctx: Ctx, from: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const i of from) {
    if (i >= ctx.s.length) continue
    const ch = ctx.s.charAt(i)
    const ok =
      node.t === 'lit' ? ch === node.c : ch !== '/' && (node.t !== 'set' || inSet(node, ch))
    if (ok) out.add(i + 1)
  }
  return out
}

function step(node: Node, ctx: Ctx, from: Set<number>): Set<number> {
  switch (node.t) {
    case 'star':
      return reach(ctx.s, from, false)
    case 'star1':
      return reach(ctx.s, from, false, 1)
    case 'any':
      return reach(ctx.s, from, true)
    case 'deep': {
      // `**/`: zero or more whole segments.
      const out = new Set<number>()
      for (const j of reach(ctx.s, from, true)) if (from.has(j) || ctx.s[j - 1] === '/') out.add(j)
      return out
    }
    case 'tail': {
      // trailing `/**`: the directory itself or anything below it.
      const out = new Set<number>()
      for (const i of from) {
        out.add(i)
        if (ctx.s[i] === '/') for (const j of reach(ctx.s, new Set([i + 1]), true)) out.add(j)
      }
      return out
    }
    case 'group':
      return stepGroup(node, ctx, from)
    default:
      return stepChar(node, ctx, from)
  }
}

export function compileGlob(pattern: string): (path: string) => boolean {
  const nodes = parseSeq({ p: pattern, i: 0 }, '')
  return (path) => {
    const ends = run(nodes, { s: path, memo: new Map() }, new Set([0]))
    // picomatch ignores one trailing slash on the path (`/api/*` matches `/api/a/`).
    return (
      ends.has(path.length) || (path.length > 1 && path.endsWith('/') && ends.has(path.length - 1))
    )
  }
}
