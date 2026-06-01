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
 * We use `createRequire(import.meta.url)` to keep the package on its native
 * CJS path. The type-only namespace import gives us the AST helpers shape.
 *
 * Returns the set of HTTP methods (uppercase) the file exports. Empty array
 * means the file has no HTTP exports (the route file is util-only).
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type * as TS from 'typescript'

import { HTTP_METHODS, type HttpMethod } from '../../core/contracts/http-methods.js'

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require_('typescript') as typeof TS

const HTTP_METHOD_NAMES = new Set<string>(HTTP_METHODS)

function hasExportModifier(modifiers: readonly TS.Modifier[] | undefined): boolean {
  if (!modifiers) return false
  for (const m of modifiers) {
    if (m.kind === ts.SyntaxKind.ExportKeyword) return true
  }
  return false
}

function collectFromStatement(stmt: TS.Statement, found: Set<HttpMethod>): void {
  // `export const GET = ...` / `export function GET ...` / `export async function GET ...`
  if (ts.isVariableStatement(stmt) && hasExportModifier(ts.getModifiers(stmt))) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && HTTP_METHOD_NAMES.has(decl.name.text)) {
        found.add(decl.name.text as HttpMethod)
      }
    }
    return
  }

  if (
    (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
    hasExportModifier(ts.getModifiers(stmt))
  ) {
    if (stmt.name && HTTP_METHOD_NAMES.has(stmt.name.text)) {
      found.add(stmt.name.text as HttpMethod)
    }
    return
  }

  // `export { GET }` / `export { handler as GET } from './shared'` (EC-5)
  if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    for (const spec of stmt.exportClause.elements) {
      // spec.name is the exported (re-)name; spec.propertyName is the original (when renamed)
      if (HTTP_METHOD_NAMES.has(spec.name.text)) {
        found.add(spec.name.text as HttpMethod)
      }
    }
  }
}

export function detectExportedHttpMethods(filePath: string, content?: string): HttpMethod[] {
  const src = content ?? readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  )
  const found = new Set<HttpMethod>()
  for (const stmt of sourceFile.statements) {
    collectFromStatement(stmt, found)
  }
  return [...found].sort()
}
