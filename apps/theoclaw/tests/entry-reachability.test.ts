import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..', 'src')

/**
 * What the product starts: the `theoclaw` bin plus every `node dist/<file>.js` the package scripts
 * run (start, import, desktop sidecar, tui). Each maps to its source under `src`.
 */
function entryPoints(): string[] {
  const manifest = JSON.parse(readFileSync(resolve(SRC, '..', 'package.json'), 'utf8')) as {
    bin: Record<string, string>
    scripts: Record<string, string>
  }
  const dist = [...Object.values(manifest.bin), ...Object.values(manifest.scripts)].flatMap(
    (command) =>
      [...command.matchAll(/(?:^|[\s])(?:node )?\.?\/?dist\/([\w/-]+)\.js/g)].map((m) => m[1]),
  )
  // `theoclaw acp` starts this one as a child process by name (src/cli.ts), so no script or bin names it.
  return [...new Set([...dist, 'main-acp'])].flatMap((stem) =>
    [`${stem}.ts`, `${stem}.tsx`].map((f) => join(SRC, f)).filter((f) => existsSync(f)),
  )
}

/**
 * Modules no entry point reaches yet. Every entry needs a reason, and the list is meant to shrink:
 * wiring a module in (or deleting it) means removing its line, and a stale line fails below.
 */
const UNREACHABLE_ALLOWLIST: Readonly<Record<string, string>> = {
  'agent/skill-workshop.ts': 'No caller yet (#1516): skill workshop is not offered to any agent.',
  'media/understanding.ts':
    'No caller yet (#1516): chat attachments are never described or transcribed.',
  'plugins/install.ts': 'No caller yet (#1516): no CLI command installs a plugin.',
  'plugins/manifest.ts': 'Only plugins/install.ts imports it (#1516).',
  'plugins/sdk.ts': 'No caller yet (#1516): the plugin SDK surface is not loaded by the product.',
  'routing/agent-routes.ts': 'No caller yet (#1516): per-agent routes are not composed.',
  'voice/talk-session.ts': 'No caller yet (#1516): no entry point starts a talk session.',
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(from), specifier)
  const stem = base.replace(/\.(m|c)?jsx?$/, '')
  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    join(stem, 'index.ts'),
    join(stem, 'index.tsx'),
    base,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/** Relative specifiers of static imports, re-exports and `import('…')` calls, tests excluded. */
function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function reachable(): Set<string> {
  const seen = new Set<string>()
  const queue = entryPoints()
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier)
      if (target) queue.push(target)
    }
  }
  return seen
}

describe('entry point reachability', () => {
  const rel = (file: string): string => relative(SRC, file).split('\\').join('/')

  it('reaches every module under src from a package entry point', () => {
    const seen = reachable()
    const unreachable = sourceFiles(SRC)
      .filter((file) => !seen.has(file))
      .map(rel)
      .filter((file) => !(file in UNREACHABLE_ALLOWLIST))

    expect(unreachable, 'modules no entry point imports (tests do not count)').toEqual([])
  })

  it('keeps the allowlist honest: every entry exists, is unreachable and says why', () => {
    const seen = reachable()
    const all = new Set(sourceFiles(SRC).map(rel))
    const seenRel = new Set([...seen].map(rel))
    for (const [file, reason] of Object.entries(UNREACHABLE_ALLOWLIST)) {
      expect(all.has(file), `${file} no longer exists`).toBe(true)
      expect(seenRel.has(file), `${file} is reachable now: drop it from the allowlist`).toBe(false)
      expect(reason.trim(), `${file} needs a reason`).not.toBe('')
    }
  })
})
