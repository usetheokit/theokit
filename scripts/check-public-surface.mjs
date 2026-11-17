#!/usr/bin/env node
/**
 * Public-surface gate: compare a package's exported declarations with a committed baseline and with
 * the baseline at the PR's base, and require a major changeset for a breaking change to a stable name.
 *
 * node scripts/check-public-surface.mjs <package dir name | package name> [--write] [--base <ref>]
 *
 * Run it AFTER `pnpm build:packages`: it reads the `types` file of each `exports` entry from `dist/`.
 *
 * - `--write` rewrites `packages/<dir>/public-surface-baseline.json`.
 * - Without it, the regenerated baseline must equal the committed one (exit 1 otherwise).
 * - It then compares with the baseline at `<base>` (default `origin/main`): a stable name removed,
 *   renamed, demoted, or whose declaration changed other than by an added optional member needs a
 *   changeset added in `<base>...HEAD` that declares the package `major`; and a stable name removed
 *   less than DEPRECATION_WINDOW_DAYS after its `deprecatedSince` fails whatever the changesets say.
 *
 * Tier: `stable` unless the JSDoc has `@experimental`. `deprecatedSince` is read from a
 * `@deprecated since YYYY-MM-DD` tag, else null.
 *
 * Exit codes: 0 pass, 1 violation or drift, 2 the check could not run (never a pass).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

const ROOT = resolve(import.meta.dirname, '..')

/** Days a stable name must stay deprecated before it may be removed. The ADR marks 90 as pending confirmation. */
export const DEPRECATION_WINDOW_DAYS = 90
export const BASELINE_FILE = 'public-surface-baseline.json'
const DAY_MS = 86_400_000

function fail(message) {
  console.error(`check-public-surface: ${message}`)
  process.exit(2)
}

/** `exports` entry name → absolute path of its declaration file. */
function entryTypes(pkgDir, manifest) {
  const out = {}
  const exp = manifest.exports
  if (!exp || typeof exp !== 'object') return out
  for (const [entry, target] of Object.entries(exp)) {
    const types = typeof target === 'object' && target !== null ? target.types : undefined
    if (typeof types === 'string') out[entry] = resolve(pkgDir, types)
  }
  return out
}

function tagsOf(symbol, checker) {
  return symbol.getJsDocTags(checker)
}

function tagText(tag) {
  return (tag.text ?? []).map((p) => p.text).join('')
}

const DECLARATION_KINDS = new Set([
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
])

function resolveAlias(sym, checker) {
  return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
}

function printDecl(d, printer) {
  return printer.printNode(ts.EmitHint.Unspecified, d, d.getSourceFile()).trim()
}

/**
 * Declarations of the package's own types that `roots` mention, transitively, other than the
 * root's own name. Exported names are tracked too: an experimental export has no policy record of
 * its own, yet a change to it changes a stable export that mentions it.
 */
function collectInternals(roots, ctx, internals) {
  const queue = [...roots]
  const own = new Set(roots.map((r) => r.name?.getText()))
  while (queue.length > 0) {
    const root = queue.pop()
    ts.forEachChild(root, function visit(node) {
      if (ts.isIdentifier(node)) {
        const raw = ctx.checker.getSymbolAtLocation(node)
        const sym = raw && resolveAlias(raw, ctx.checker)
        const fresh = (sym?.declarations ?? []).filter((d) => isOwnDeclaration(d, ctx))
        if (sym && fresh.length > 0 && !own.has(sym.name) && !internals.has(sym.name)) {
          internals.set(
            sym.name,
            fresh
              .map((d) => printDecl(d, ctx.printer))
              .sort()
              .join('\n'),
          )
          queue.push(...fresh)
        }
      }
      ts.forEachChild(node, visit)
    })
  }
}

function isOwnDeclaration(d, ctx) {
  const sf = d.getSourceFile()
  return (
    DECLARATION_KINDS.has(d.kind) &&
    !ctx.program.isSourceFileDefaultLibrary(sf) &&
    !ctx.program.isSourceFileFromExternalLibrary(sf) &&
    !sf.fileName.includes('/node_modules/')
  )
}

/** True when the export exists at runtime: a value that is not re-exported through `export type`. */
function hasRuntimeValue(sym, target, checker) {
  let cur = sym
  while (cur && cur.flags & ts.SymbolFlags.Alias) {
    if ((cur.declarations ?? []).some((d) => ts.isTypeOnlyImportOrExportDeclaration(d)))
      return false
    cur = checker.getImmediateAliasedSymbol(cur)
  }
  return Boolean(target.flags & ts.SymbolFlags.Value)
}

function describeSymbol(sym, ctx) {
  const target = resolveAlias(sym, ctx.checker)
  const tags = [...tagsOf(sym, ctx.checker), ...tagsOf(target, ctx.checker)]
  const deprecated = tags.find((t) => t.name === 'deprecated')
  const since = deprecated ? /since\s+(\d{4}-\d{2}-\d{2})/.exec(tagText(deprecated)) : null
  const decls = target.declarations ?? []
  const refs = new Map()
  collectInternals(decls, ctx, refs)
  return {
    tier: tags.some((t) => t.name === 'experimental') ? 'experimental' : 'stable',
    // Source order, not sorted: overload order decides which signature TypeScript picks.
    declaration: decls.map((d) => printDecl(d, ctx.printer)).join('\n'),
    runtime: hasRuntimeValue(sym, target, ctx.checker),
    deprecatedSince: since ? since[1] : null,
    references: [...refs.keys()].sort(),
    refTexts: refs,
  }
}

function byName([a], [b]) {
  return a < b ? -1 : 1
}

/** Build the baseline for the package in `pkgDir`, resolving names with the TypeScript checker. */
export function extractSurface(pkgDir) {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const files = entryTypes(pkgDir, manifest)
  for (const [entry, file] of Object.entries(files)) {
    if (!existsSync(file))
      fail(`entry "${entry}" points at ${file}, which does not exist. Build first.`)
  }
  const program = ts.createProgram(Object.values(files), {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  })
  const checker = program.getTypeChecker()
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  const entries = {}
  for (const entry of Object.keys(files).sort()) {
    const sf = program.getSourceFile(files[entry])
    const modSym = sf && checker.getSymbolAtLocation(sf)
    const syms = modSym ? checker.getExportsOfModule(modSym) : []
    const ctx = { program, checker, printer }
    const names = {}
    const internals = {}
    for (const [name, rec] of syms.map((x) => [x.name, describeSymbol(x, ctx)]).sort(byName)) {
      const { refTexts, ...plain } = rec
      names[name] = plain
      for (const [k, v] of refTexts) internals[k] = v
    }
    entries[entry] = {
      names,
      internals: Object.fromEntries(Object.entries(internals).sort(byName)),
    }
  }
  return { package: manifest.name, entries }
}

/** JSON in the shape Prettier prints it (short arrays on one line), so the file passes `format:check`. */
export function serialize(baseline) {
  const lines = JSON.stringify(baseline, null, 2).split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const flat = flatArray(lines, i)
    out.push(flat ? flat.text : lines[i])
    i = flat ? flat.next : i + 1
  }
  return `${out.join('\n')}\n`
}

/** The array opened on `lines[i]` as one line when it holds only strings and fits in 100 columns. */
function flatArray(lines, i) {
  if (!lines[i].endsWith('[')) return null
  const close = lines.findIndex((l, j) => j > i && l.trim().startsWith(']'))
  const items = lines.slice(i + 1, close)
  if (close < 0 || items.length === 0 || !items.every((l) => /^ +"/.test(l))) return null
  const comma = lines[close].endsWith(',') ? ',' : ''
  const text = `${lines[i]}${items.map((l) => l.trim().replace(/,$/, '')).join(', ')}]${comma}`
  return text.length <= 100 ? { text, next: close + 1 } : null
}

/** Text of a declaration with its member list cut out, plus the members, or null when it has none. */
function shape(text) {
  const sf = ts.createSourceFile('d.ts', text, ts.ScriptTarget.ES2022, true)
  const node = sf.statements[0]
  if (!node) return null
  let members
  if (ts.isInterfaceDeclaration(node)) members = node.members
  else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type))
    members = node.type.members
  else return null
  const shell = text.slice(0, members.pos) + text.slice(members.end)
  const list = members.map((m) => ({
    text: m.getText(sf).replace(/[;,]$/, ''),
    optional: Boolean(m.questionToken),
  }))
  return { shell, list }
}

/** True when `next` only adds optional members to an interface / object type alias. */
export function addsOnlyOptionalMembers(prev, next) {
  const a = shape(prev)
  const b = shape(next)
  if (!a || !b || a.shell !== b.shell) return false
  // The old members must appear in `b` in the same order; anything between them must be optional.
  let i = 0
  for (const m of b.list) {
    if (i < a.list.length && m.text === a.list[i].text) i++
    else if (!m.optional) return false
  }
  return i === a.list.length
}

function referenceBreakage(old, oldInternals, curInternals) {
  for (const ref of old.references ?? []) {
    const before = oldInternals[ref]
    const after = curInternals[ref]
    if (before === after) continue
    if (after === undefined || !addsOnlyOptionalMembers(before, after)) {
      return `referenced type ${ref} changed`
    }
  }
  return null
}

function breakage(old, cur, oldInternals, curInternals) {
  if (!cur) return 'removed or renamed'
  if (cur.tier !== 'stable') return 'demoted to experimental'
  if (old.runtime && !cur.runtime) return 'runtime export became type-only'
  if (
    cur.declaration !== old.declaration &&
    !addsOnlyOptionalMembers(old.declaration, cur.declaration)
  ) {
    return 'declaration changed'
  }
  return referenceBreakage(old, oldInternals, curInternals)
}

function windowProblem(id, old, cur, now) {
  if ((cur && cur.tier === 'stable') || !old.deprecatedSince) return null
  const days = Math.floor((now - Date.parse(old.deprecatedSince)) / DAY_MS)
  if (days >= DEPRECATION_WINDOW_DAYS) return null
  return `${id} removed ${days} days after deprecatedSince ${old.deprecatedSince}; the window is ${DEPRECATION_WINDOW_DAYS} days`
}

/** Breaking changes (and window violations) from `prev` to `next`. `now` is epoch ms. */
export function comparePolicy(prev, next, { major, now }) {
  const out = []
  for (const [entry, { names, internals }] of Object.entries(prev.entries)) {
    for (const [name, old] of Object.entries(names)) {
      if (old.tier !== 'stable') continue
      const cur = next.entries[entry]?.names[name]
      const id = `${entry}:${name}`
      const what = breakage(old, cur, internals, next.entries[entry]?.internals ?? {})
      if (!what) continue
      if (!major)
        out.push(`${id} ${what} and no changeset in the range declares "${prev.package}": major`)
      const late = windowProblem(id, old, cur, now)
      if (late) out.push(late)
    }
  }
  return out
}

/** True when any changeset text declares `pkg` as `major` in its frontmatter. */
export function declaresMajor(texts, pkg) {
  const wanted = new Set([`'${pkg}': major`, `"${pkg}": major`, `${pkg}: major`])
  return texts.some((text) => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!m) return false
    return m[1].split(/\r?\n/).some((line) => wanted.has(line.split('#')[0].trim()))
  })
}

function git(args) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return fail(`\`git ${args.join(' ')}\` failed — ${err.message}. This is not a pass.`)
  }
}

function findPackage(arg) {
  const packages = join(ROOT, 'packages')
  for (const dir of readdirSync(packages)) {
    const file = join(packages, dir, 'package.json')
    if (!existsSync(file)) continue
    if (dir === arg || JSON.parse(readFileSync(file, 'utf8')).name === arg)
      return join(packages, dir)
  }
  return fail(`no package "${arg}" under packages/`)
}

function main(argv) {
  const write = argv.includes('--write')
  const bi = argv.indexOf('--base')
  const base = bi >= 0 ? argv[bi + 1] : 'origin/main'
  const arg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--base')
  if (!arg) return fail('usage: check-public-surface.mjs <package> [--write] [--base <ref>]')
  const pkgDir = findPackage(arg)
  const baselinePath = join(pkgDir, BASELINE_FILE)
  const fresh = extractSurface(pkgDir)
  if (write) {
    writeFileSync(baselinePath, serialize(fresh))
    console.log(`check-public-surface: wrote ${baselinePath}`)
    return 0
  }
  let code = 0
  if (!existsSync(baselinePath) || readFileSync(baselinePath, 'utf8') !== serialize(fresh)) {
    console.error(
      `check-public-surface: ${fresh.package}'s surface differs from ${BASELINE_FILE}. Run with --write and commit it.`,
    )
    code = 1
  }
  git(['rev-parse', '--verify', `${base}^{commit}`])
  const rel = `${pkgDir.slice(ROOT.length + 1)}/${BASELINE_FILE}`
  const exists = git(['ls-tree', '--name-only', base, rel]).trim() !== ''
  if (!exists) return code
  const prev = JSON.parse(git(['show', `${base}:${rel}`]))
  const added = git([
    'diff',
    '--name-only',
    '--diff-filter=A',
    `${base}...HEAD`,
    '--',
    '.changeset',
  ])
    .split('\n')
    .filter((f) => /^\.changeset\/.+\.md$/.test(f) && !f.endsWith('README.md'))
    .map((f) => readFileSync(join(ROOT, f), 'utf8'))
  const problems = comparePolicy(prev, fresh, {
    major: declaresMajor(added, fresh.package),
    now: Date.now(),
  })
  for (const p of problems) console.error(`check-public-surface: ${p}`)
  return problems.length > 0 ? 1 : code
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)))
}
