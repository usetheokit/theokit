import { describe, expect, it } from 'vitest'

import config from '../../vitest.config.js'

/**
 * The coverage run writes its report even when a test fails (B-700).
 *
 * `root-serial` tests read `packages/theo/dist` while another project can be rebuilding it, so the
 * coverage leg can go red on a race that `npm test` already passed at the same head. The kit's
 * validator (#1251) re-runs such a failure on its own, but it can only read the coverage numbers if
 * vitest wrote a report. Vitest's default skips the report on a failed run.
 */
describe('the coverage configuration', () => {
  it('test_coverage_writes_its_report_when_a_test_fails', () => {
    const coverage = (config as { test?: { coverage?: { reportOnFailure?: boolean } } }).test
      ?.coverage
    expect(coverage?.reportOnFailure).toBe(true)
  })
})
