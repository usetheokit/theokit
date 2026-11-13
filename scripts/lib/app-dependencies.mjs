/**
 * Dependency checks shared by every app under `apps/`: registry pins are exact, and `@theokit/*`
 * registry pins are not behind what is published. Ported from TheoClaw's `check-exact-versions.mjs`
 * and TheoCode's `check-theokit-updates.mjs`.
 */

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies']
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const SCOPE = '@theokit/'
const DEFAULT_SKIP = ['workspace:', 'link:', 'file:']

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isExact = (specifier) =>
  typeof specifier === 'string' && (EXACT.test(specifier) || specifier === 'workspace:*')

/**
 * Same rule as TheoClaw's check: exact semver (prerelease allowed) or exactly 'workspace:*'.
 * A section that is present but not an object throws.
 *
 * @returns {{ section: string, name: string, specifier: string }[]}
 */
export function exactVersionViolations(manifest) {
  const violations = []
  for (const section of SECTIONS) {
    if (!(section in manifest)) continue
    const entries = manifest[section]
    if (!isPlainObject(entries)) throw new TypeError(`${section} is not an object`)
    for (const [name, specifier] of Object.entries(entries)) {
      if (!isExact(specifier)) violations.push({ section, name, specifier: String(specifier) })
    }
  }
  return violations
}

/** Which dist-tag a package follows, read from the installed version: a prerelease means `next`. */
export function channelFor(installed) {
  if (installed === undefined) return 'latest'
  return installed.includes('-') ? 'next' : 'latest'
}

/** The version to compare against from a dist-tags map; `next` falls back to `latest`. */
export function publishedFor(installed, tags) {
  return tags[channelFor(installed)] ?? tags.latest
}

const lookup = (source, name) => (typeof source === 'function' ? source(name) : source?.[name])

const majorOf = (version) => Number(version.split('.')[0])

/**
 * `@theokit/*` staleness for registry pins only. A declaration whose range starts with one of
 * `skipProtocols` is skipped and its name listed in `inRepo`: it is built from this tree, so the
 * registry has no answer for it.
 *
 * `installedVersion` and `publishedVersion` are each a function `(name) => version | undefined`
 * or a `{ [name]: version }` map; injected so callers decide where versions come from.
 *
 * @param {{ name: string, range: string }[]} declarations
 * @returns {{ rows: { name: string, installed: string, latest: string, current: boolean, major: boolean }[], inRepo: string[] }}
 */
export function theokitStaleness(
  declarations,
  { installedVersion, publishedVersion, skipProtocols = DEFAULT_SKIP },
) {
  const inRepo = new Set()
  const pins = new Set()
  for (const { name, range } of declarations) {
    if (!name.startsWith(SCOPE)) continue
    if (typeof range === 'string' && skipProtocols.some((p) => range.startsWith(p)))
      inRepo.add(name)
    else pins.add(name)
  }
  const rows = []
  for (const name of [...pins].sort()) {
    const installed = lookup(installedVersion, name)
    const latest = lookup(publishedVersion, name)
    if (latest === undefined) continue
    rows.push({
      name,
      installed: installed ?? '(not installed)',
      latest,
      current: installed === latest,
      major: installed !== undefined && majorOf(latest) > majorOf(installed),
    })
  }
  return { rows, inRepo: [...inRepo].sort() }
}
