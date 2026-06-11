/**
 * @ProjectContext() — declares how the agent understands the codebase.
 *
 * A code assistant needs to know: what's the project root, which files
 * are relevant, how to parse code structure, what to ignore. This
 * metadata feeds the context window management and file discovery.
 *
 * @example
 * ```ts
 * @Agent({ name: 'coder', route: '/agents/coder' })
 * @ProjectContext({
 *   rootMarkers: ['package.json', 'tsconfig.json'],
 *   indexStrategy: 'tree-sitter',
 *   maxFilesInContext: 20,
 *   relevanceStrategy: 'git-history',
 *   ignorePatterns: ['node_modules', 'dist', '.git'],
 * })
 * class CoderAgent { ... }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const PROJECT_CONTEXT_CONFIG = Symbol.for('theokit:agents:project-context')

export type IndexStrategy =
  | 'tree-sitter'    // Parse AST for structural understanding
  | 'regex'          // Simple regex-based symbol extraction
  | 'none'           // No indexing — rely on grep/glob only

export type RelevanceStrategy =
  | 'git-history'     // Prioritize recently-edited files
  | 'import-graph'    // Follow import chains from entry points
  | 'semantic'        // Embedding-based similarity search
  | 'manual'          // Only files explicitly provided

export interface ProjectContextOptions {
  /** Files that mark the project root (searched upward from cwd). */
  rootMarkers?: string[]
  /** How to index the codebase for structural understanding. */
  indexStrategy?: IndexStrategy
  /** Maximum files to include in context per request. */
  maxFilesInContext?: number
  /** How to rank file relevance when selecting context. */
  relevanceStrategy?: RelevanceStrategy
  /** Glob patterns to exclude from indexing and context. */
  ignorePatterns?: string[]
  /** File extensions to include in indexing (default: all text files). */
  includeExtensions?: string[]
}

export function ProjectContext(options: ProjectContextOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(PROJECT_CONTEXT_CONFIG, target, {
      rootMarkers: ['package.json', 'tsconfig.json', 'go.mod', 'Cargo.toml', 'pyproject.toml'],
      indexStrategy: 'regex',
      maxFilesInContext: 20,
      relevanceStrategy: 'git-history',
      ignorePatterns: ['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__'],
      ...options,
    })
  }
}

export function getProjectContextConfig(target: Function): ProjectContextOptions | undefined {
  return getMeta<ProjectContextOptions>(PROJECT_CONTEXT_CONFIG, target)
}
