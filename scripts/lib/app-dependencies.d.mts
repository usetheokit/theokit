/** Types for `app-dependencies.mjs`, so the root test imports it without a suppression. */

export interface ExactViolation {
  section: string
  name: string
  specifier: string
}
export interface Declaration {
  name: string
  range: string
}
export interface StalenessRow {
  name: string
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
    installedVersion: (name: string) => string | undefined
    publishedVersion: (name: string) => string | undefined
    skipProtocols?: readonly string[]
  },
): { rows: StalenessRow[]; inRepo: string[]; unjudged: { name: string; reason: string }[] }
