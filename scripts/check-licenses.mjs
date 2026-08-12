#!/usr/bin/env node
/**
 * License compliance gate — pnpm-native (uses `pnpm licenses list --json`).
 *
 * ## Why a custom script instead of a library
 *
 * `license-checker(-rseidelsohn)` assumes npm's flat `node_modules` layout. pnpm hoists into
 * `.pnpm/`, so the tool reports "No packages found" — green for the wrong reason, the worst kind of
 * gate. `pnpm licenses` reads the lockfile directly and works in every package-manager mode.
 * (Parsimony ladder rung 3: the platform already answers the question.)
 *
 * ## Policy
 *
 * Only licenses compatible with permissive redistribution. Copyleft (GPL/AGPL/LGPL/SSPL) and
 * undeclared licenses block the gate — a framework that ships a viral license silently imposes it on
 * every app built on top, and "no license declared" means all rights reserved, not "probably MIT".
 *
 * ## What changed when it was restored (backlog B-M67-13)
 *
 * The file was deleted inside `efe63edf` ("Release v0.4.0"), a commit large enough that the loss went
 * unnoticed. `package.json` and the CI job kept calling it, so `License compliance` has failed with
 * `MODULE_NOT_FOUND` ever since — a control reported red for so long that nobody read it, and which
 * never checked a single license.
 *
 * The policy below is the original, verbatim; it was well reasoned. One thing changed: the DECISION
 * is a pure function over an injected package set (`findLicenseViolations`), so it is testable
 * without a registry, a network or a `pnpm` process. The previous shape wrapped `execSync` around the
 * same logic and could only be exercised end-to-end, which is why a bug in the SPDX handling would
 * have been invisible. Tests: `tests/unit/check-licenses.test.ts`.
 */
import { execSync } from 'node:child_process'
import process from 'node:process'

/**
 * Licenses compatible with permissive redistribution.
 *
 * @type {ReadonlySet<string>}
 */
export const ALLOWLIST = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'BlueOak-1.0.0',
  'WTFPL',
  'PSF-2.0',
  // MPL-2.0 is FILE-level copyleft, not viral like GPL: modifications stay inside the licensed file
  // and do not propagate to the consumer's code. Arrives transitively via `lightningcss`
  // (Tailwind v4 / Vite ecosystem).
  'MPL-2.0',
])

/**
 * Strip surrounding parentheses without a regex.
 *
 * Character iteration on purpose: the regex form is safe, but SonarJS flags it conservatively for
 * backtracking, and an `eslint-disable` on a security rule is a worse trade than four lines.
 *
 * @param {string} s
 * @returns {string}
 */
function stripParens(s) {
  let result = s
  while (result.length > 0 && (result.startsWith('(') || result.startsWith(')'))) {
    result = result.slice(1)
  }
  while (result.length > 0 && (result.endsWith('(') || result.endsWith(')'))) {
    result = result.slice(0, -1)
  }
  return result
}

/**
 * Does this SPDX expression satisfy the policy?
 *
 * `OR` is a choice offered to the consumer: one acceptable branch is enough, and refusing
 * `(MIT OR GPL-3.0)` would reject a package the policy actually permits — the false positive that
 * gets a gate switched off. `AND` imposes every term, so one copyleft term contaminates the whole.
 *
 * @param {string | undefined | null} spdx
 * @returns {boolean}
 */
export function isLicenseAllowed(spdx) {
  if (!spdx || spdx === 'UNKNOWN') return false
  const orParts = spdx.split(' OR ').map((s) => stripParens(s.trim()))
  for (const part of orParts) {
    const andParts = part.split(' AND ').map((s) => s.trim())
    if (andParts.every((p) => ALLOWLIST.has(stripParens(p)))) return true
  }
  // Single-license fallback — covers the `(MIT)` shape.
  return ALLOWLIST.has(stripParens(spdx.trim()))
}

/**
 * Packages whose manifest OMITS the `license` field although the license is unambiguous elsewhere.
 *
 * The hatch exists for missing METADATA, never for a license the policy refuses — an entry whose
 * verified SPDX is itself disallowed still fails the gate. Widening `ALLOWLIST` to accept `Unknown`
 * would have been the lazy fix and would let every genuinely unlicensed package through.
 *
 * Keyed by exact `name@version` on purpose: a version bump re-opens the question. That is stricter
 * than the sunset date the deps-audit allowlist uses, because a pin cannot expire unnoticed — it
 * simply stops matching.
 *
 * Each entry records HOW it was verified. An exemption without evidence is an assertion, and the
 * next reader must be able to re-check it without repeating the investigation.
 *
 * @type {ReadonlyMap<string, { spdx: string, evidence: string }>}
 */
export const KNOWN_LICENSE_OVERRIDES = new Map([
  [
    'khroma@2.1.0',
    {
      spdx: 'MIT',
      evidence:
        'ships `license` at the package root reading "The MIT License (MIT)", and its readme.md ' +
        '§ License says "MIT © Fabio Spampinato, Andrew Maney"; only the package.json field is ' +
        'absent. Arrives transitively via `mermaid`. Verified 2026-08-12 on the installed tarball.',
    },
  ],
  // --- our own published packages (issue #213) ---
  //
  // Three packages we publish omit the `license` field, so a consumer installing the tarball gets no
  // grant even though every source repo is Apache-2.0. The grant travels in the artifact, not on
  // GitHub. Fixed at the source where possible; these entries keep the gate meaningful meanwhile,
  // and each names the obligation rather than hiding it.
  [
    '@theokit/agents@1.0.0',
    {
      spdx: 'Apache-2.0',
      evidence:
        'this repository, whose root LICENSE is Apache-2.0. The 1.0.0 TARBALL cannot be fixed — npm ' +
        'artifacts are immutable — and the current source now declares the field, so every future ' +
        'publish is correct. This ancient copy is dragged in by `@theokit/studio@0.1.0`, seven ' +
        'majors behind (backlog B-M67-03); the real fix for this line is that migration, not a ' +
        'manifest edit. Issue #213.',
    },
  ],
  [
    '@theokit/sdk-pty@0.3.0',
    {
      spdx: 'Apache-2.0',
      evidence:
        '`usetheodev/theokit-sdk`, whose root LICENSE is Apache-2.0 (verified 2026-08-12). Fix is a ' +
        'source change plus republish in that repo, out of reach from here. Issue #213.',
    },
  ],
  [
    '@theokit/studio@0.1.0',
    {
      spdx: 'Apache-2.0',
      evidence:
        '`usetheodev/theokit-studio`, whose root LICENSE is Apache-2.0 (verified 2026-08-12). Fix ' +
        'is a source change plus republish in that repo, out of reach from here. Issue #213.',
    },
  ],
])

/**
 * @typedef {{ name: string, versions?: string[] }} LicensedPackage
 * @typedef {{ name: string, version: string, license: string }} Violation
 * @typedef {{ violations: Violation[], total: number }} LicenseReport
 */

/** The reported values that mean "this package declared nothing", as opposed to declaring something. */
const UNDECLARED = new Set(['Unknown', 'UNKNOWN', 'unknown', '', 'UNLICENSED'])

/**
 * Does an override clear this package?
 *
 * Only when the reported license is UNDECLARED. An override answers "what is the license that the
 * manifest forgot to state" — it must never answer "ignore the license the manifest DID state". If a
 * package declares `GPL-3.0`, nothing is missing and there is nothing to override; treating the two
 * cases the same would turn the hatch into a bypass, which is the whole failure mode an allowlist is
 * supposed to avoid.
 *
 * The verified SPDX still goes through the policy, so an override cannot admit a license the policy
 * refuses either.
 *
 * @param {string} name
 * @param {string} version
 * @param {string} reportedLicense
 * @returns {boolean}
 */
function isCoveredByOverride(name, version, reportedLicense) {
  if (!UNDECLARED.has(reportedLicense)) return false
  const override = KNOWN_LICENSE_OVERRIDES.get(`${name}@${version}`)
  return override !== undefined && isLicenseAllowed(override.spdx)
}

/**
 * Which packages in `byLicense` sit under a license the policy refuses.
 *
 * Pure, with the package set injected (DIP): the CLI passes `pnpm licenses list --json`, the tests
 * pass a literal. Every offending package is named individually — reporting only the license would
 * leave the operator grepping for which dependency brought it in.
 *
 * @param {Record<string, LicensedPackage[]>} byLicense
 * @returns {LicenseReport}
 */
export function findLicenseViolations(byLicense) {
  /** @type {Violation[]} */
  const violations = []
  let total = 0
  for (const [license, pkgs] of Object.entries(byLicense)) {
    total += pkgs.length
    if (isLicenseAllowed(license)) continue
    for (const pkg of pkgs) {
      const version = pkg.versions?.[0] ?? '?'
      if (isCoveredByOverride(pkg.name, version, license)) continue
      violations.push({ name: pkg.name, version, license })
    }
  }
  return { violations, total }
}

if (process.argv[1]?.endsWith('check-licenses.mjs')) {
  let raw
  try {
    // `pnpm` from PATH: this gate runs only as a developer-local or CI step inside the repo, and an
    // absolute path would pin one installation while closing no threat a build script does not
    // already have.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer-local build tool
    raw = execSync('pnpm licenses list --prod --json', { encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch (err) {
    console.error('Failed to run `pnpm licenses list`:', err.message)
    process.exit(2)
  }

  const { violations, total } = findLicenseViolations(JSON.parse(raw))

  if (violations.length > 0) {
    console.error(`License compliance: FAIL — ${violations.length} disallowed package(s)\n`)
    for (const v of violations) {
      console.error(`  ${v.name}@${v.version}  →  ${v.license}`)
    }
    console.error(`\nAllowed: ${[...ALLOWLIST].sort().join(', ')}`)
    process.exit(1)
  }

  console.log(`License compliance: OK — ${total} packages, all permissive.`)
}
