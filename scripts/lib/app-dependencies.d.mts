/** Types for `app-dependencies.mjs`. */
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
type VersionSource = ((name: string) => string | undefined) | Record<string, string | undefined>

export function exactVersionViolations(manifest: Record<string, unknown>): ExactViolation[]
export function channelFor(installed: string | undefined): 'latest' | 'next'
export function publishedFor(
  installed: string | undefined,
  tags: Record<string, string | undefined>,
): string | undefined
export function theokitStaleness(
  declarations: Declaration[],
  options: {
    installedVersion: VersionSource
    publishedVersion: VersionSource
    skipProtocols?: string[]
  },
): { rows: StalenessRow[]; inRepo: string[] }
