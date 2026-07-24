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
import type { ProjectContextOptions } from '../types.js'

const PROJECT_CONTEXT_CONFIG = Symbol.for('theokit:agents:project-context')

export type { IndexStrategy } from '../types.js'

export type { RelevanceStrategy } from '../types.js'

export type { ProjectContextOptions } from '../types.js'

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
