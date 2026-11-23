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
 * A second signal is by name: a file that declares (top level) a function or class named like an export
 * of a `@theokit/*` package the app depends on is reported as a `duplicate`, and the gate fails on it,
 * unless `ALLOWED` lists the file (and symbol) with a reason. Exports are read from each package's
 * declaration files through the TypeScript checker, over every subpath of its `exports` map; when the
 * surface cannot be read the gate throws rather than pass on an empty set.
 *
 * Exit: 0 gap and presenter are 0; 1 either is above 0; 2 nothing resolved.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

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

/**
 * Files allowed to declare a framework export's name. Each entry needs a substantive reason.
 * @type {ReadonlyArray<{ path: string, symbol?: string, reason: string }>}
 */
export const ALLOWED = []

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

function typesEntry(target) {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) return target.map(typesEntry).find((t) => t !== undefined)
  if (target === null || typeof target !== 'object') return undefined
  for (const key of ['types', 'import', 'default', 'require']) {
    const found = typesEntry(target[key])
    if (found !== undefined) return found
  }
  return undefined
}

function declarationFor(file) {
  const candidates = [file, file.replace(/\.(c|m)?js$/, (_m, k) => `.d.${k ?? ""}ts`)]
  return candidates.find((c) => /\.d\.[cm]?ts$/.test(c) && existsSync(c))
}

function packageDir(root, name) {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return undefined
  }
}

/** Names exported by every subpath of every `@theokit/*` dependency of the app at `root`. */
export function frameworkExports(root = APP_ROOT) {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return new Map()
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => n.startsWith('@theokit/'))
  const entries = []
  for (const dep of deps) {
    const dir = packageDir(root, dep)
    if (dir === undefined) throw new Error(`joinery: cannot resolve ${dep}; install and build before measuring`)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const map = manifest.exports ?? { '.': manifest.types ?? manifest.main }
    for (const [sub, target] of Object.entries(typeof map === 'string' ? { '.': map } : map)) {
      if (!sub.startsWith('.') || sub.includes('*') || sub.endsWith('package.json')) continue
      const rel = typesEntry(target)
      if (rel !== undefined && !/\.[cm]?[jt]sx?$/.test(rel)) continue
      const file = rel === undefined ? undefined : declarationFor(resolve(dir, rel))
      if (file === undefined) throw new Error(`joinery: no declaration file for ${dep}${sub.slice(1)}; build the package first`)
      entries.push({ module: dep + sub.slice(1), file })
    }
  }
  const program = ts.createProgram(entries.map((e) => e.file), {
    allowJs: false,
    skipLibCheck: true,
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  })
  const checker = program.getTypeChecker()
  /** @type {Map<string, string[]>} name -> modules exporting it */
  const names = new Map()
  for (const { module, file } of entries) {
    const source = program.getSourceFile(file)
    const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source)
    if (symbol === undefined) throw new Error(`joinery: cannot read the exports of ${module}`)
    for (const exported of checker.getExportsOfModule(symbol)) {
      const list = names.get(exported.name) ?? []
      list.push(module)
      names.set(exported.name, list)
    }
  }
  if (deps.length > 0 && names.size === 0) throw new Error('joinery: read no framework export')
  return names
}

/** Top-level function and class names declared in `text`. */
export function declaredNames(text, path = 'x.ts') {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out = []
  for (const node of source.statements) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) out.push(node.name.text)
  }
  return out
}

/** The measurement: `{ resolved, rows, totals, duplicates }`. Pure of process state apart from reading `root`. */
export function measure(root = APP_ROOT, rules = RULES, signals = SIGNALS, exportsByName = frameworkExports(root), allowed = ALLOWED) {
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
  const duplicates = []
  for (const row of rows) {
    const text = readFileSync(join(root, row.path), 'utf8')
    for (const name of declaredNames(text, row.path)) {
      const modules = exportsByName.get(name)
      if (modules === undefined) continue
      if (allowed.some((a) => a.path === row.path && (a.symbol === undefined || a.symbol === name) && a.reason.trim() !== '')) continue
      duplicates.push({ path: row.path, symbol: name, modules })
    }
  }
  const totals = { gap: 0, presenter: 0, mixed: 0, app: 0, total: 0 }
  for (const row of rows) {
    totals[row.category] += row.lines
    totals.total += row.lines
  }
  return { resolved: rows.length, joined: rows.filter((row) => row.joined).length, rows, totals, duplicates }
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
  const dupes = (result.duplicates ?? []).map((d) => `  duplicate ${d.symbol} ${d.path} (exported by ${d.modules.join(', ')})`)
  if (gap > 0 || presenter > 0 || dupes.length > 0) {
    const offenders = result.rows
      .filter((row) => (row.category === 'gap' || row.category === 'presenter') && row.lines > 0)
      .map((row) => `  ${row.category} ${row.lines} ${row.path}`)
    return { code: 1, report: [summary, 'gap, presenter or framework-name duplicate above 0:', ...offenders, ...dupes].join('\n') }
  }
  return { code: 0, report: summary }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, report } = verdict(measure())
  ;(code === 0 ? console.log : console.error)(report)
  process.exitCode = code
}
