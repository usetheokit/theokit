/**
 * Does this agent file declare an access policy? (usetheokit/theokit#365)
 *
 * The sibling of `detect-route-policy.ts`, and deliberately the same instrument: the TypeScript
 * AST rather than a regex, because `// policy: ...` in a comment and the word `policy` in a doc
 * block are both things an agent file legitimately contains, and neither declares anything.
 *
 * ## What it looks for, and why it is simpler than the route detector
 *
 * A route file declares one policy PER exported HTTP method, so the route detector has to return a
 * set and reason about which method carried which config. An agent file is one agent, so the
 * question is a single yes or no: is there a top-level export named `policy`?
 *
 * ```ts
 * export const policy = 'public'
 * export const policy = ({ subject, params }) => requireOwner(subject, ownerOf(params.sessionId))
 * const policy = ...; export { policy }
 * export { agentPolicy as policy } from './shared'   // ← also counts; see below
 * ```
 *
 * ## Where this is deliberately laxer than the route detector
 *
 * The route detector refuses `export { GET } from './shared'`, on the reasoning that it cannot see
 * whether the re-exported value declares a policy. Here there is nothing to look inside: the export
 * IS the policy, so a re-export names one as surely as a local const does. The value's SHAPE is
 * checked at runtime by `readAgentPolicy`, which throws on anything that is neither `'public'` nor
 * a function — so a wrong type fails loudly rather than being served open.
 */
import { createRequire } from 'node:module'

import type * as TS from 'typescript'

const require_ = createRequire(import.meta.url)

const ts = require_('typescript') as typeof TS

const POLICY_EXPORT = 'policy'

function hasExportModifier(modifiers: readonly TS.Modifier[] | undefined): boolean {
  if (!modifiers) return false
  for (const m of modifiers) {
    if (m.kind === ts.SyntaxKind.ExportKeyword) return true
  }
  return false
}

/** `export const policy = ...` (also `let`/`var`, which are legal if unusual). */
function variableStatementDeclaresPolicy(stmt: TS.VariableStatement): boolean {
  if (!hasExportModifier(ts.getModifiers(stmt))) return false
  return stmt.declarationList.declarations.some(
    (decl) => ts.isIdentifier(decl.name) && decl.name.text === POLICY_EXPORT,
  )
}

/** `export { policy }`, `export { p as policy }`, `export { p as policy } from './shared'`. */
function exportDeclarationDeclaresPolicy(stmt: TS.ExportDeclaration): boolean {
  if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return false
  return stmt.exportClause.elements.some((spec) => spec.name.text === POLICY_EXPORT)
}

/** `export function policy() {}` — a function declaration is a policy as much as a const is. */
function functionDeclarationDeclaresPolicy(stmt: TS.FunctionDeclaration): boolean {
  return hasExportModifier(ts.getModifiers(stmt)) && stmt.name?.text === POLICY_EXPORT
}

/**
 * True when the file has a top-level export named `policy`.
 *
 * `content` is passed in rather than read here so the caller reads each file once — the same
 * contract `detectMethodsWithDeclaredPolicy` follows.
 */
export function declaresAgentPolicy(filePath: string, content: string): boolean {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  )
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt) && variableStatementDeclaresPolicy(stmt)) return true
    if (ts.isExportDeclaration(stmt) && exportDeclarationDeclaresPolicy(stmt)) return true
    if (ts.isFunctionDeclaration(stmt) && functionDeclarationDeclaresPolicy(stmt)) return true
  }
  return false
}
