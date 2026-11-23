/**
 * `@theokit/agents` capability layer (M52) — object-oriented, composable agent authoring that produces
 * the existing `CompiledAgentOptions` waist. Replaces decorator/metadata authoring (removed in M53).
 */
export * from './capability.js'
export * from './capabilities.js'
export * from './registry.js'
export * from './agent-capabilities.js'
// M69 — the composed shape as a published value; see \`agent-shape.ts\` for why the internal draft
// could not serve the three construction sites.
export * from './agent-shape.js'
export * from './toolbox.js'

// M91 — the tool-collection primitive; the counterpart missing from the sandbox and interactive
// seams the layer already publishes.
export { Toolset, ToolsetError, type NamedTool } from './toolset.js'
// Re-exported ON PURPOSE. A deprecated alias a consumer cannot import is not a migration path, it
// is a rename with extra words. Sunset: the next major.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export { type ToolComNome } from './toolset.js'
