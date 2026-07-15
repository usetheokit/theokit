/**
 * M48 (ecosystem-integration-guarantee) — the supported `@theokit/sdk` version range + a pure,
 * dependency-free `||`-aware caret semver check. Shared by the contract test's version-drift guard
 * (`tests/integration/contract-sdk-seam.test.ts`) and the boot-time fail-fast
 * (`cli/commands/start/assert-sdk-compatible.ts`) — one source of truth for "which SDK theokit runs on".
 *
 * Web-Standards discipline (G8/R3a): `server/` code uses no `node:*`. This is pure string logic.
 * Rule 9 (Don't Reinvent) trade-off (ADR D1): a small inline caret checker instead of a `semver`
 * dependency, matching the theo-ui seam's existing precedent (`contract-usetheo-ui-vite-plugin.test.ts`).
 */

/** The single source of truth for the supported SDK range. Mirrors the `package.json` peer floor. */
export const SUPPORTED_SDK_RANGE = '^4.0.1'

// Bounded semver: three `\d+` tuples + an optional `-tag.N` prerelease. No nested quantifiers →
// no catastrophic backtracking; the security/detect-unsafe-regex heuristic false-positives here.
// eslint-disable-next-line security/detect-unsafe-regex -- bounded \d+ groups anchored by `.`/`$`, no backtracking
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/

interface Semver {
  major: string
  minor: string
  patch: string
  tag: string | undefined
  pre: string | undefined
}

function parseSemver(value: string): Semver | null {
  const m = SEMVER_RE.exec(value)
  if (!m) return null
  return { major: m[1], minor: m[2], patch: m[3], tag: m[4], pre: m[5] }
}

/**
 * Return `true` when `version` satisfies `range`, where `range` is a `||`-joined series of caret
 * pins (e.g. `^4.0.1` or `^0.14.0 || ^1.0.0`). A version satisfies the range when it satisfies ANY
 * clause. Covers the semver subset the monorepo uses (caret pins, optional `-tag.N` prerelease);
 * no range-sets or build metadata.
 */
export function satisfiesSdkRange(version: string, range: string): boolean {
  return range
    .split('||')
    .map((clause) => clause.trim())
    .some((clause) => satisfiesSingleCaret(version, clause))
}

function satisfiesSingleCaret(version: string, range: string): boolean {
  if (!range.startsWith('^')) return false
  const pin = parseSemver(range.slice(1))
  const ver = parseSemver(version)
  if (!pin || !ver) return false
  if (pin.tag !== undefined) return satisfiesPrereleaseCaret(ver, pin)
  if (ver.tag !== undefined) return false // a prerelease never satisfies a stable caret pin
  return satisfiesStableCaret(ver, pin)
}

function satisfiesPrereleaseCaret(ver: Semver, pin: Semver): boolean {
  // Prerelease pin: same X.Y.Z + same tag + prerelease number >= pin's.
  if (pin.major !== ver.major || pin.minor !== ver.minor || pin.patch !== ver.patch) return false
  if (ver.tag !== pin.tag) return false
  return Number(ver.pre ?? '0') >= Number(pin.pre ?? '0')
}

function satisfiesStableCaret(ver: Semver, pin: Semver): boolean {
  if (pin.major !== ver.major) return false
  if (pin.major === '0') {
    // 0.X.Y caret: minor must match exactly; patch can be >=.
    if (pin.minor !== ver.minor) return false
    return Number(ver.patch) >= Number(pin.patch)
  }
  // >= 1.0.0 caret: minor can be >=, patch anything within the same/greater minor.
  if (Number(ver.minor) > Number(pin.minor)) return true
  if (Number(ver.minor) === Number(pin.minor)) return Number(ver.patch) >= Number(pin.patch)
  return false
}
