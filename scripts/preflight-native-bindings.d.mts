/**
 * Ambient declaration for the preflight ESM script (theokit copy).
 * Matches the exports in preflight-native-bindings.mjs.
 */

/** Dependency-injected preflight core (test seam). */
export interface PreflightDeps {
  abi: string
  sentinelDir: string
  repoRoot: string
  nativeDeps: string[]
  depsVersions: Record<string, string>
  requireDep: (name: string) => void
  exerciseDep: (name: string) => void
  resolveBinding: (name: string) => string | undefined
  execFile: (cmd: string, args: string[], opts: { cwd?: string; stdio?: unknown }) => void
  existsSync: (p: string) => boolean
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void
  writeFileSync: (p: string, data: string) => void
  env: Record<string, string | undefined>
}

export function findRebuildCwd(failingBindingPath: string | undefined, defaultCwd: string): string
export function _preflight(deps: PreflightDeps): Promise<void>
export function ensureNativeBindings(): Promise<void>
