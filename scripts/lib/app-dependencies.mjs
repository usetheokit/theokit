/**
 * Dependency checks shared by every app under `apps/`: registry pins are exact, and `@theokit/*`
 * registry pins are not behind what is published. In-repo links are never compared with the registry.
 */

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
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

const isPlainOverride = (key, value) =>
  typeof value === 'string' && EXACT.test(value) && !/[>@\s]/.test(key.slice(1))

const namesTheokit = (key, value) => (key + JSON.stringify(value)).includes(SCOPE)

/** Top-level entries of `overrides` and `pnpm.overrides`. */
const overrideEntries = (manifest) =>
  [
    ['overrides', manifest.overrides],
    ['pnpm.overrides', manifest.pnpm?.overrides],
  ].flatMap(([source, map]) =>
    isPlainObject(map) ? Object.entries(map).map(([key, value]) => [key, value, source]) : [],
  )

/**
 * Every `{ name, range }` a manifest declares in the dependency sections, plus plain overrides: a
 * top-level key that is a bare package name with an exact version. Other overrides are not judged,
 * see `unjudgedOverrides`.
 */
export function collectDeclarations(manifest) {
  const out = []
  for (const section of SECTIONS) {
    if (!isPlainObject(manifest[section])) continue
    for (const [name, range] of Object.entries(manifest[section])) out.push({ name, range })
  }
  for (const [key, value, source] of overrideEntries(manifest)) {
    if (isPlainOverride(key, value))
      out.push({ name: key, range: value, override: `${source}: ${key}` })
  }
  return out
}

/** Overrides naming an `@theokit` package that are not a plain exact override, as written. */
export function unjudgedOverrides(manifest) {
  return overrideEntries(manifest)
    .filter(([key, value]) => namesTheokit(key, value) && !isPlainOverride(key, value))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
}

/** `next` for a prerelease installed, `latest` otherwise. */
export function channelFor(installed) {
  return typeof installed === 'string' && installed.split('+')[0].includes('-') ? 'next' : 'latest'
}

const identifierOrder = (a, b) => {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  if (aNum !== bNum) return aNum ? -1 : 1
  return a < b ? -1 : Number(a > b)
}

/** Semver precedence: negative when `a` is lower than `b`, 0 when equal, positive when higher. Build metadata is ignored. */
export function compareVersions(a, b) {
  const [aCore, aPre] = String(a).split('+')[0].split(/-(.*)/s)
  const [bCore, bPre] = String(b).split('+')[0].split(/-(.*)/s)
  const aNums = aCore.split('.').map(Number)
  const bNums = bCore.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (aNums[i] ?? 0) - (bNums[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  if (aPre === undefined || bPre === undefined)
    return Number(aPre === undefined) - Number(bPre === undefined)
  const aIds = aPre.split('.')
  const bIds = bPre.split('.')
  for (let i = 0; i < Math.min(aIds.length, bIds.length); i++) {
    const order = identifierOrder(aIds[i], bIds[i])
    if (order !== 0) return order
  }
  return Math.sign(aIds.length - bIds.length)
}

const publishedOf = (publishedVersion, name, installed) =>
  installed === undefined ? undefined : publishedVersion(name, installed)

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
  const pinned = new Map()
  for (const declaration of declarations) {
    const { name, range, override } = declaration
    if (!name.startsWith(SCOPE)) continue
    if (typeof range === 'string' && skipProtocols.some((p) => range.startsWith(p)))
      inRepo.add(name)
    else pinned.set(`${name}\0${override ?? ''}`, declaration)
  }
  const rows = []
  const unjudged = []
  for (const [, declaration] of [...pinned].sort(([a], [b]) => (a < b ? -1 : Number(a > b)))) {
    const { name, override } = declaration
    // A declaration is resolved on its own: a direct pin and an override of the same package may differ.
    const via = override === undefined ? {} : { override }
    const installed = installedVersion(name, declaration)
    const latest = publishedOf(publishedVersion, name, installed)
    if (installed === undefined || latest === undefined) {
      unjudged.push({
        name,
        ...via,
        reason: installed === undefined ? 'not installed' : 'published version unavailable',
      })
      continue
    }
    rows.push({
      name,
      ...via,
      installed,
      latest,
      // `current` means not behind: a pin ahead of the published tag is not stale.
      current: compareVersions(installed, latest) >= 0,
      major: majorOf(latest) > majorOf(installed),
    })
  }
  return { rows, inRepo: [...inRepo].sort(), unjudged }
}
