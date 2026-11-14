/**
 * Dependency checks shared by every app under `apps/`: registry pins are exact, and `@theokit/*`
 * registry pins are not behind what is published. In-repo links are never compared with the registry.
 */

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies']
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const SCOPE = '@theokit/'
const DEFAULT_SKIP = ['workspace:', 'link:', 'file:']

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isExact = (specifier) =>
  typeof specifier === 'string' && (EXACT.test(specifier) || specifier === 'workspace:*')

/** Same rule as TheoClaw's check: exact semver (prerelease allowed) or exactly `workspace:*`. */
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

/** Every `{ name, range }` a manifest declares in the dependency sections and `overrides`. */
export function collectDeclarations(manifest) {
  const out = []
  for (const section of [...SECTIONS, 'overrides']) {
    if (!isPlainObject(manifest[section])) continue
    for (const [name, range] of Object.entries(manifest[section])) out.push({ name, range })
  }
  return out
}

/** `next` for a prerelease installed, `latest` otherwise. */
export function channelFor(installed) {
  return typeof installed === 'string' && installed.includes('-') ? 'next' : 'latest'
}

const majorOf = (version) => Number(String(version).split('.')[0])

/**
 * @theokit/* staleness for registry pins only. A range starting with one of `skipProtocols` is
 * skipped and listed in `inRepo`.
 */
export function theokitStaleness(
  declarations,
  { installedVersion, publishedVersion, skipProtocols = DEFAULT_SKIP },
) {
  const inRepo = new Set()
  const pinned = new Set()
  for (const { name, range } of declarations) {
    if (!name.startsWith(SCOPE)) continue
    if (typeof range === 'string' && skipProtocols.some((p) => range.startsWith(p)))
      inRepo.add(name)
    else pinned.add(name)
  }
  const rows = []
  for (const name of [...pinned].sort()) {
    const installed = installedVersion(name)
    const latest = publishedVersion(name)
    if (installed === undefined || latest === undefined) continue
    rows.push({
      name,
      installed,
      latest,
      current: installed === latest,
      major: majorOf(latest) > majorOf(installed),
    })
  }
  return { rows, inRepo: [...inRepo].sort() }
}
