/** Types for `invention-reachability.mjs`. */

export interface AllowlistEntry {
  symbol: string
  /** ISO date. Past it the entry is IGNORED and the finding re-fires at full severity. */
  sunset: string
  rationale: string
}

export interface SourceModule {
  path: string
  text: string
}

export interface InventionFinding {
  type: string
  module: string
  /** Every function in the module taking the type — which one to export is the human's call. */
  enforcement: string[]
  allowlistExpired: boolean
}

/**
 * Exported decision-shaped types whose enforcement is not reachable from the published surface.
 * A heuristic by construction — see the module's own docblock.
 */
export declare function findUnreachableEnforcement(input: {
  modules: SourceModule[]
  publishedNames: Set<string>
  allowlist?: AllowlistEntry[]
  /** ISO date, injectable so the sunset check is testable without waiting for a calendar. */
  today?: string
}): InventionFinding[]
