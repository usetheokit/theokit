import { describe, expect, it } from 'vitest'

import {
  findLicenseViolations,
  isLicenseAllowed,
  KNOWN_LICENSE_OVERRIDES,
} from '../../scripts/check-licenses.mjs'

/**
 * The license-compliance gate.
 *
 * ## Why this test exists at all
 *
 * `scripts/check-licenses.mjs` was deleted inside `efe63edf` ("Release v0.4.0"), a commit large
 * enough that a script vanishing went unnoticed. `package.json` kept `"check:licenses": "node
 * scripts/check-licenses.mjs"` and the CI job kept calling it, so the job has failed with
 * `MODULE_NOT_FOUND` ever since — a compliance control that has been reported red for so long that
 * nobody reads it, and which never checked a single license.
 *
 * The restored version keeps the original policy verbatim (it was well reasoned) and changes one
 * thing: the DECISION is a pure function over an injected package list, so it can be tested without
 * a registry, a network, or a `pnpm` process. The old script wrapped `execSync` around the same
 * logic and could only be exercised end-to-end — which is why a bug in the SPDX handling would have
 * been invisible.
 */

describe('isLicenseAllowed — the SPDX expression policy', () => {
  it('test_a_plain_permissive_license_is_allowed', () => {
    for (const spdx of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', '0BSD']) {
      expect(isLicenseAllowed(spdx), spdx).toBe(true)
    }
  })

  it('test_copyleft_is_refused', () => {
    // The whole point of the gate. GPL/AGPL propagate to the consumer's code; a framework that
    // ships one silently imposes it on every app built on top.
    for (const spdx of ['GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'SSPL-1.0']) {
      expect(isLicenseAllowed(spdx), spdx).toBe(false)
    }
  })

  it('test_an_absent_or_unknown_license_is_refused', () => {
    // A package that declares nothing is not "probably MIT" — it is all rights reserved by default.
    for (const spdx of ['UNKNOWN', '', undefined, null] as const) {
      expect(isLicenseAllowed(spdx), String(spdx)).toBe(false)
    }
  })

  it('test_an_OR_expression_passes_when_ANY_branch_is_allowed', () => {
    // `(MIT OR GPL-3.0)` lets the consumer pick MIT. Refusing it would reject a package the policy
    // actually permits, and the false positive is what makes a gate get switched off.
    expect(isLicenseAllowed('(MIT OR GPL-3.0)')).toBe(true)
    expect(isLicenseAllowed('MIT OR Apache-2.0')).toBe(true)
  })

  it('test_an_OR_expression_fails_when_NO_branch_is_allowed', () => {
    expect(isLicenseAllowed('(GPL-3.0 OR AGPL-3.0)')).toBe(false)
  })

  it('test_an_AND_expression_requires_EVERY_term', () => {
    // `A AND B` imposes both. One copyleft term contaminates the whole expression.
    expect(isLicenseAllowed('MIT AND Apache-2.0')).toBe(true)
    expect(isLicenseAllowed('MIT AND GPL-3.0')).toBe(false)
  })

  it('test_surrounding_parentheses_do_not_change_the_verdict', () => {
    expect(isLicenseAllowed('(MIT)')).toBe(true)
    expect(isLicenseAllowed('(GPL-3.0)')).toBe(false)
  })

  it('test_MPL_2_0_is_allowed_and_the_reason_is_recorded', () => {
    // File-level copyleft, not viral: modifications stay in the licensed file and do not propagate
    // to the consumer's code. Arrives transitively via `lightningcss` (Tailwind v4 / Vite).
    expect(isLicenseAllowed('MPL-2.0')).toBe(true)
  })
})

describe('findLicenseViolations — the report over an injected package set', () => {
  it('test_a_fully_permissive_tree_has_no_violations', () => {
    const report = findLicenseViolations({
      MIT: [{ name: 'left-pad', versions: ['1.3.0'] }],
      'Apache-2.0': [{ name: 'zod', versions: ['4.0.0'] }],
    })
    expect(report.violations).toEqual([])
    expect(report.total).toBe(2)
  })

  it('test_every_package_under_a_refused_license_is_named', () => {
    // Naming only the license would leave the operator grepping for which dependency brought it.
    const report = findLicenseViolations({
      MIT: [{ name: 'ok-pkg', versions: ['1.0.0'] }],
      'GPL-3.0': [
        { name: 'copyleft-a', versions: ['2.0.0'] },
        { name: 'copyleft-b', versions: ['3.1.0'] },
      ],
    })
    expect(report.violations).toEqual([
      { name: 'copyleft-a', version: '2.0.0', license: 'GPL-3.0' },
      { name: 'copyleft-b', version: '3.1.0', license: 'GPL-3.0' },
    ])
    expect(report.total).toBe(3)
  })

  it('test_a_package_with_no_version_still_reports_rather_than_crashing', () => {
    // The shape of `pnpm licenses list --json` is not a contract we control. A missing `versions`
    // must degrade to a placeholder, never take the gate down — a crash here reads as "the gate is
    // broken" and gets ignored, which is exactly how this script spent months missing.
    const report = findLicenseViolations({ 'GPL-3.0': [{ name: 'no-version' }] })
    expect(report.violations).toEqual([{ name: 'no-version', version: '?', license: 'GPL-3.0' }])
  })

  it('test_an_empty_tree_is_not_a_violation', () => {
    expect(findLicenseViolations({})).toEqual({ violations: [], total: 0 })
  })
})

describe('KNOWN_LICENSE_OVERRIDES — the narrow escape hatch', () => {
  it('test_an_override_clears_a_package_whose_manifest_omits_the_field', () => {
    // Some packages ship a LICENSE file and say the license in their readme, and simply forget the
    // `license` field in `package.json`. Refusing those is a false positive; widening the ALLOWLIST
    // to accept `Unknown` would be the lazy fix and would let EVERY unlicensed package through.
    // The override is keyed by exact `name@version` and carries the evidence.
    const report = findLicenseViolations({
      Unknown: [{ name: 'khroma', versions: ['2.1.0'] }],
    })
    expect(report.violations).toEqual([])
  })

  it('test_the_override_is_pinned_to_the_exact_version', () => {
    // A version bump re-opens the question. Pinning by name only would carry a stale verification
    // forward forever — the failure mode the deps-audit allowlist uses a sunset date to avoid, and
    // a version pin is stricter than a date because it cannot silently expire unnoticed.
    const report = findLicenseViolations({
      Unknown: [{ name: 'khroma', versions: ['3.0.0'] }],
    })
    expect(report.violations).toEqual([{ name: 'khroma', version: '3.0.0', license: 'Unknown' }])
  })

  it('test_every_override_records_where_the_license_was_verified', () => {
    // An exemption without evidence is an assertion. The next reader must be able to re-check it
    // without repeating the investigation.
    expect(KNOWN_LICENSE_OVERRIDES.size).toBeGreaterThan(0)
    for (const [key, entry] of KNOWN_LICENSE_OVERRIDES) {
      expect(key, `${key} must be pinned as name@version`).toMatch(/@\d+\.\d+\.\d+$/)
      expect(entry.spdx, `${key} must declare the verified SPDX id`).toBeTruthy()
      expect(entry.evidence.length, `${key} must record HOW it was verified`).toBeGreaterThan(20)
    }
  })

  it('test_an_override_does_NOT_clear_a_genuinely_copyleft_package', () => {
    // The hatch exists for MISSING metadata, never for a license the policy refuses. An override
    // whose verified SPDX is itself disallowed must not pass.
    const report = findLicenseViolations({ 'GPL-3.0': [{ name: 'khroma', versions: ['2.1.0'] }] })
    expect(report.violations).toHaveLength(1)
  })
})
