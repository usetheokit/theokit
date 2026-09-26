/**
 * Detect which HTTP-method named exports a route file declares.
 *
 * Uses the TypeScript compiler API (not regex) per G1 edge-case review EC-4:
 * regex over file content emits false positives for `// export const GET = ...`
 * in comments and `` `export const GET = ...` `` in template literals. AST
 * walking avoids both classes of bug.
 *
 * `typescript` ships as CommonJS with internal dynamic `require('fs')`.
 * When loaded via ESM `import`, the dynamic requires fail at module-bootstrap.
 * A CJS require keeps the package on its native path, and it is taken LAZILY — see `ts_()` below
 * for what module-scope cost on Cloudflare Workers. The type-only namespace import gives us the AST
 * helpers shape.
 *
 * Returns the set of HTTP methods (uppercase) the file exports. Empty array
 * means the file has no HTTP exports (the route file is util-only).
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type * as TS from 'typescript'

import { HTTP_METHODS, type HttpMethod } from '../../core/contracts/http-methods.js'
import { compareByCodeUnit } from '../_internal/compare-by-code-unit.js'

/**
 * The compiler, loaded on first use and never at import time.
 *
 * This was module scope, and a Cloudflare deploy found what that costs: `theokit/server/scan` is
 * imported by the generated worker, Cloudflare EXECUTES the module during validation, and there
 * `import.meta.url` is undefined — so `createRequire` threw before the worker answered a request
 * (B-263, error 10021). `wrangler deploy --dry-run` returns exit 0 on the same bundle: it bundles
 * and does not execute.
 *
 * The second reason holds regardless of Workers: this is a BUILD-TIME AST scanner, and nothing that
 * merely imports it should pay for the TypeScript compiler.
 *
 * Cached, so scanning many files still loads it once.
 */
let compiler: typeof TS | undefined

function ts_(): typeof TS {
  compiler ??= createRequire(import.meta.url)('typescript') as typeof TS
  return compiler
}

const HTTP_METHOD_NAMES = new Set<string>(HTTP_METHODS)

function hasExportModifier(modifiers: readonly TS.Modifier[] | undefined): boolean {
  if (!modifiers) return false
  for (const m of modifiers) {
    if (m.kind === ts_().SyntaxKind.ExportKeyword) return true
  }
  return false
}

// An AST visitor over the export forms (const / function / named export) is inherently branchy;
// the complexity is in the grammar it walks, not in tangled logic. Splitting it would scatter one
// cohesive dispatch across helpers for no readability gain.
// eslint-disable-next-line complexity -- AST visitor, see above
function collectFromStatement(stmt: TS.Statement, found: Set<HttpMethod>): void {
  // `export const GET = ...` / `export function GET ...` / `export async function GET ...`
  if (ts_().isVariableStatement(stmt) && hasExportModifier(ts_().getModifiers(stmt))) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts_().isIdentifier(decl.name) && HTTP_METHOD_NAMES.has(decl.name.text)) {
        found.add(decl.name.text as HttpMethod)
      }
    }
    return
  }

  if (
    (ts_().isFunctionDeclaration(stmt) || ts_().isClassDeclaration(stmt)) &&
    hasExportModifier(ts_().getModifiers(stmt))
  ) {
    if (stmt.name && HTTP_METHOD_NAMES.has(stmt.name.text)) {
      found.add(stmt.name.text as HttpMethod)
    }
    return
  }

  // `export { GET }` / `export { handler as GET } from './shared'` (EC-5)
  if (
    ts_().isExportDeclaration(stmt) &&
    stmt.exportClause &&
    ts_().isNamedExports(stmt.exportClause)
  ) {
    for (const spec of stmt.exportClause.elements) {
      // spec.name is the exported (re-)name; spec.propertyName is the original (when renamed)
      if (HTTP_METHOD_NAMES.has(spec.name.text)) {
        found.add(spec.name.text as HttpMethod)
      }
    }
  }
}

export function detectExportedHttpMethods(filePath: string, content?: string): HttpMethod[] {
  // `filePath` is a route module the framework itself discovered by globbing the project — never
  // user input at runtime. Reading it by a computed path is the whole job of a source scanner.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- framework-controlled path
  const src = content ?? readFileSync(filePath, 'utf-8')
  const sourceFile = ts_().createSourceFile(
    filePath,
    src,
    ts_().ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts_().ScriptKind.TS,
  )
  const found = new Set<HttpMethod>()
  for (const stmt of sourceFile.statements) {
    collectFromStatement(stmt, found)
  }
  // HTTP method names are ASCII, so no collation disagrees about them today.
  // Ordered by code unit anyway, so that "build output orders by code unit"
  // stays a rule a reader can check by grep rather than a rule with exceptions
  // each needing its own argument (usetheokit/theokit#351).
  return [...found].sort(compareByCodeUnit)
}
