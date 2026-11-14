/** Types for `app-dependencies.mjs`, so the root test imports it without a suppression. */

export interface ExactViolation {
  section: string
  name: string
  specifier: string
}
export interface Declaration {
  name: string
  range: string
  /** Full override path (nested keys joined with ` > `); absent for dependency sections. */
  override?: string
}
export interface StalenessRow {
  name: string
  override?: string
  installed: string
  latest: string
  current: boolean
  major: boolean
}

/** Exact semver (prerelease allowed) or exactly `workspace:*`; throws when a section is not an object. */
export function exactVersionViolations(manifest: Record<string, unknown>): ExactViolation[]
export function collectDeclarations(manifest: Record<string, unknown>): Declaration[]
export function channelFor(installed: string | undefined): 'next' | 'latest'
/** Registry pins only; in-repo protocols are listed in `inRepo`. A pin with no installed or published version is listed in `unjudged`. */
export function theokitStaleness(
  declarations: readonly Declaration[],
  options: {
    installedVersion: (name: string, declaration: Declaration) => string | undefined
    publishedVersion: (name: string, installed: string) => string | undefined
    skipProtocols?: readonly string[]
  },
): {
  rows: StalenessRow[]
  inRepo: string[]
  unjudged: { name: string; override?: string; reason: string }[]
}
/** Semver precedence: negative, 0 or positive as `a` is lower than, equal to or higher than `b`. */
export function compareVersions(a: string, b: string): number
/** The package names along an override path, outermost first. */
export function overridePackages(path: string): string[]
export function overrideSelectors(path: string): { name: string; spec?: string }[]
