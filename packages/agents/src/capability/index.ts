/**
 * `@theokit/agents` capability layer (M52) — object-oriented, composable agent authoring that produces
 * the existing `CompiledAgentOptions` waist. Replaces decorator/metadata authoring (removed in M53).
 */
export * from './capability.js'
export * from './capabilities.js'
export * from './registry.js'
export * from './agent-capabilities.js'
export * from './toolbox.js'

// M91 — a primitiva de coleção de tools; a contraparte que faltava às costuras de sandbox e
// interactive que a camada já publica.
export { Toolset, ToolsetError, type NamedTool } from './toolset.js'
// Re-exported ON PURPOSE. A deprecated alias a consumer cannot import is not a migration path, it
// is a rename with extra words. Sunset: the next major.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export { type ToolComNome } from './toolset.js'
