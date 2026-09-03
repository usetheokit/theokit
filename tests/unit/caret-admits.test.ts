import { describe, expect, it } from 'vitest'

// @ts-expect-error — a plain .mjs release script with no type declarations; the function under test
// is four lines of arithmetic and typing the whole script to reach it would be the larger change.
import { caretAdmits } from '../../scripts/sync-template-pins.mjs'

/**
 * Does a template's caret range admit the version npm actually serves?
 *
 * The question behind `usetheokit/theokit#424`, asked a second time. That issue was `theokit`
 * pinned at `^0.48.3` while the repo was at `0.49.0`; this is `@theokit/agents` pinned at `^10.1.0`
 * while npm's `latest` was `12.1.0` — two majors behind, so every generated app missed the 11.0.0
 * fix that stopped the server's raw error text reaching the browser.
 *
 * `sync-template-pins.mjs` was written for the first case and skipped the second, because in
 * prerelease mode it abstained on the premise that "the pin it has points at the last stable line".
 * Nothing checked that premise. This is the arithmetic that checks it.
 */
describe('caretAdmits — 1.x and above', () => {
  it('admits a newer minor on the same major', () => {
    expect(caretAdmits('^1.1.0', '1.10.2')).toBe(true)
  })

  it('refuses a newer major — the case that shipped', () => {
    expect(caretAdmits('^10.1.0', '12.1.0')).toBe(false)
  })

  it('refuses an older minor, which is a pin ahead of the registry', () => {
    // Legitimate between a version bump and its publish, so the caller reports rather than fails.
    expect(caretAdmits('^12.5.0', '12.1.0')).toBe(false)
  })

  it('admits the exact version', () => {
    expect(caretAdmits('^12.1.0', '12.1.0')).toBe(true)
  })
})

describe('caretAdmits — the 0.x line, where a caret pins the minor', () => {
  it('admits a patch on the same minor', () => {
    expect(caretAdmits('^0.64.0', '0.64.3')).toBe(true)
  })

  it('refuses a newer minor — this is the shape of #424 itself', () => {
    expect(caretAdmits('^0.48.3', '0.49.0')).toBe(false)
  })
})

describe('caretAdmits — what it refuses to guess', () => {
  it.each(['~1.2.3', '>=1.2.3', '1.2.3', 'workspace:*', 'latest', ''])(
    'returns undefined for %j rather than a boolean',
    (range) => {
      // `undefined` is not `false`. A range this function cannot read is UNKNOWN, and the caller
      // prints it as unverified instead of failing a release on a shape nobody taught it.
      expect(caretAdmits(range, '1.2.3')).toBeUndefined()
    },
  )

  it('returns undefined when the version is not plain semver', () => {
    expect(caretAdmits('^1.2.3', 'next')).toBeUndefined()
  })
})
