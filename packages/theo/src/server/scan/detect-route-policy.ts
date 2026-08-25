/**
 * Detect which HTTP-method exports of a route file declare an access policy.
 *
 * The companion of `detect-http-methods.ts`, and deliberately the same shape:
 * the TypeScript AST rather than a regex, because `// policy: 'public'` in a
 * comment and `` `policy` `` in a doc string are both things a route file
 * legitimately contains, and neither declares anything.
 *
 * ADR 0001 decides that a route says who may call it, `'public'` included, and
 * that absence stops meaning open. This is the half of that decision the
 * scanner can answer: which exports said something. `scanServerRoutes` turns
 * the silence into a build error.
 *
 * ## What counts as a declaration
 *
 * Two forms, because the framework ships two ways to write a route:
 *
 * ```ts
 * export const GET = route().policy('public').handler(fn).build()   // builder
 * export const GET = defineRoute({ policy: fn, handler: fn })       // object
 * ```
 *
 * Only the config position is inspected — the top level of an object literal
 * passed to a call, and `.policy(...)` links of a call chain. The handler's
 * BODY is never walked, so a handler that happens to return `{ policy: ... }`
 * does not satisfy the gate. Reading deeper would trade a false build error for
 * a false pass, and a false pass here is a route nobody protected that the gate
 * reported as protected.
 *
 * ## What it deliberately cannot see
 *
 * `export { GET } from './shared'` re-exports across a module boundary, and
 * `export const GET = makeAdminRoute(fn)` hides the config inside a helper.
 * Both come back "not declared", which fails the build. That direction is the
 * chosen one: the cost is an explicit declaration on a route that already had
 * one somewhere else, and the alternative cost is a route reported as declared
 * because the scanner guessed.
 */
import { createRequire } from 'node:module'

import type * as TS from 'typescript'

import { HTTP_METHODS, type HttpMethod } from '../../core/contracts/http-methods.js'

const require_ = createRequire(import.meta.url)

const ts = require_('typescript') as typeof TS

const HTTP_METHOD_NAMES = new Set<string>(HTTP_METHODS)

const POLICY_KEY = 'policy'

function hasExportModifier(modifiers: readonly TS.Modifier[] | undefined): boolean {
  if (!modifiers) return false
  for (const m of modifiers) {
    if (m.kind === ts.SyntaxKind.ExportKeyword) return true
  }
  return false
}

/** Strip the wrappers that carry no runtime meaning (`(x)`, `x as T`, `x satisfies T`, `x!`). */
function unwrap(expression: TS.Expression): TS.Expression {
  let current = expression
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression
      continue
    }
    return current
  }
}

function propertyNameIsPolicy(name: TS.PropertyName | undefined): boolean {
  if (name === undefined) return false
  if (ts.isIdentifier(name)) return name.text === POLICY_KEY
  if (ts.isStringLiteral(name)) return name.text === POLICY_KEY
  return false
}

/**
 * What a route said about who may call it.
 *
 * `'public'` is the string literal ADR 0001 gives a meaning to; everything else is a function this
 * pass cannot evaluate, and is reported `'guarded'`. That asymmetry is deliberate — see
 * `policyKindOfArgument`.
 */
export type RoutePolicyKind = 'public' | 'guarded'

/**
 * The kind an argument in the `policy` position declares.
 *
 * Only the bare literal `'public'` is read as open. An identifier, a property access, a call, a
 * template — anything this pass cannot evaluate — comes back `'guarded'`.
 *
 * The two mistakes are not symmetric. Labelling an open route `'guarded'` costs a gate that fails
 * to fire on a route somebody left open on purpose. Labelling a guarded route `'public'` would put
 * a protected route on a list of exposures and, worse, train a reader to disbelieve the list. Only
 * the literal is legible, so only the literal is believed.
 */
function policyKindOfArgument(expression: TS.Expression): RoutePolicyKind {
  const arg = unwrap(expression)
  return ts.isStringLiteral(arg) && arg.text === 'public' ? 'public' : 'guarded'
}

/** A `policy` key at the TOP level of a config object literal. Never deeper. */
function objectPolicyKind(literal: TS.ObjectLiteralExpression): RoutePolicyKind | undefined {
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) continue
    if (!propertyNameIsPolicy(property.name)) continue
    // `{ policy: x }` carries an initializer; `{ policy }` shorthand does not, and a shorthand
    // reference is exactly the unreadable case that takes the safe label.
    return ts.isPropertyAssignment(property)
      ? policyKindOfArgument(property.initializer)
      : 'guarded'
  }
  return undefined
}

/**
 * Does this initializer declare a policy?
 *
 * Walks the call chain leftwards (`.build()` -> `.handler()` -> `.policy()`) and
 * checks the arguments each call receives, which is where the object form puts
 * its config. Nothing else is visited.
 */
function policyKind(expression: TS.Expression): RoutePolicyKind | undefined {
  const expr = unwrap(expression)

  if (ts.isObjectLiteralExpression(expr)) return objectPolicyKind(expr)

  if (!ts.isCallExpression(expr)) return undefined

  const callee = unwrap(expr.expression)

  if (ts.isPropertyAccessExpression(callee) && callee.name.text === POLICY_KEY) {
    // `.policy()` with no argument declares the key and says nothing readable.
    return expr.arguments.length === 0 ? 'guarded' : policyKindOfArgument(expr.arguments[0])
  }

  for (const argument of expr.arguments) {
    const arg = unwrap(argument)
    if (!ts.isObjectLiteralExpression(arg)) continue
    const kind = objectPolicyKind(arg)
    if (kind !== undefined) return kind
  }

  // Keep walking the chain: `route().policy(p).handler(h).build()` reaches
  // `.policy` only by stepping left through `.build` and `.handler`.
  if (ts.isPropertyAccessExpression(callee)) return policyKind(callee.expression)

  return undefined
}

/** Every top-level `const x = <expr>` in the file, so `export { x as GET }` can be resolved. */
function collectLocalInitializers(sourceFile: TS.SourceFile): Map<string, TS.Expression> {
  const locals = new Map<string, TS.Expression>()
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) {
        locals.set(decl.name.text, decl.initializer)
      }
    }
  }
  return locals
}

/** `export const GET = ...` */
function collectFromVariableStatement(
  stmt: TS.VariableStatement,
  declared: Map<HttpMethod, RoutePolicyKind>,
): void {
  if (!hasExportModifier(ts.getModifiers(stmt))) return
  for (const decl of stmt.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name) || !HTTP_METHOD_NAMES.has(decl.name.text)) continue
    if (decl.initializer === undefined) continue
    const kind = policyKind(decl.initializer)
    if (kind !== undefined) declared.set(decl.name.text as HttpMethod, kind)
  }
}

/**
 * `export { GET }` / `export { handler as GET }` — resolvable only when the
 * declaration is in this file. A re-export with a module specifier is not.
 */
function collectFromExportDeclaration(
  stmt: TS.ExportDeclaration,
  locals: Map<string, TS.Expression>,
  declared: Map<HttpMethod, RoutePolicyKind>,
): void {
  if (stmt.moduleSpecifier !== undefined) return
  if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return
  for (const spec of stmt.exportClause.elements) {
    if (!HTTP_METHOD_NAMES.has(spec.name.text)) continue
    const local = locals.get((spec.propertyName ?? spec.name).text)
    if (local === undefined) continue
    const kind = policyKind(local)
    if (kind !== undefined) declared.set(spec.name.text as HttpMethod, kind)
  }
}

function collectFromStatement(
  stmt: TS.Statement,
  locals: Map<string, TS.Expression>,
  declared: Map<HttpMethod, RoutePolicyKind>,
): void {
  if (ts.isVariableStatement(stmt)) {
    collectFromVariableStatement(stmt, declared)
    return
  }
  if (ts.isExportDeclaration(stmt)) {
    collectFromExportDeclaration(stmt, locals, declared)
  }
  // `export function GET() {}` and `export class GET {}` reach neither branch,
  // on purpose: a bare function has no config object to carry a policy.
}

/**
 * What each HTTP-method export of this file declared — `'public'` or `'guarded'`.
 *
 * The KEYS answer the question ADR 0001 asks at build time: which methods declared a policy at all.
 * The VALUES answer the half it left open until now: whether the declaration protects anything.
 * One map, so the build gate and the exposure gate cannot disagree about which methods declared.
 *
 * `content` is passed in rather than read here so the scanner reads each route file once and hands
 * the same source to both detectors.
 */
export function detectRoutePolicyKinds(
  filePath: string,
  content: string,
): Map<HttpMethod, RoutePolicyKind> {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  )
  const locals = collectLocalInitializers(sourceFile)
  const declared = new Map<HttpMethod, RoutePolicyKind>()
  for (const stmt of sourceFile.statements) {
    collectFromStatement(stmt, locals, declared)
  }
  return declared
}
