/**
 * `@theokit/agents/tool-scope` — M78: bind `{ projectRoot, writeRoot, sandbox }` once.
 *
 * A subpath rather than a member of the main barrel, for the reason measured in `../index.ts`: the
 * main bundle sits at 34.7K against a 35K ceiling, and this is a capability only a product that
 * builds a tool registry needs.
 *
 * Not named `tools` because `@theokit/agents/tools` already exists as the pass-through of the SDK's
 * tool factories. Two subpaths whose names differ by an `s` would be a naming trap, not a surface.
 */
export { bindToolScope, sandboxWritePolicy } from './tool-scope.js'
export type { SandboxWritePolicy, ToolScope, ToolScopeInput } from './tool-scope.js'
