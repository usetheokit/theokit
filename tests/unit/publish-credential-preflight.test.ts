import { describe, expect, it } from 'vitest'

import { diagnoseCredential, npmrcCandidates } from '../../scripts/verify-publish-credential.mjs'

/**
 * Is the npm credential on the WRITE path? — asked before the release, not after.
 *
 * ## What happened, and the wrong diagnosis it first produced
 *
 * The M67 release ran end to end — build, version, tag, GitHub release — and died on the last step
 * with `E404 Not Found - PUT https://registry.npmjs.org/@theokit%2fagents`. Nothing was published,
 * while `main` kept a tag and a CHANGELOG claiming three new versions.
 *
 * The first version of this gate diagnosed a read-only token, and was **wrong**. Three different
 * tokens were declared read-only; all three could publish. The real cause was the SHAPE of the
 * credential: it was passed as an `npm_config_//registry.npmjs.org/:_authToken=…` environment
 * variable, which npm honours on READS — `whoami` and `owner ls` both succeeded — and does not apply
 * on the WRITE path. The `PUT` went out anonymous, and the registry answers an unauthenticated write
 * with **404 rather than 403**, so it does not leak whether the package exists.
 *
 * That is why the misdiagnosis was so easy, and it is the thing worth encoding: npm returns the same
 * status for "you may not" and "you are nobody".
 *
 * The previous oracle probed `npm access list packages <name>` — an ORG endpoint, while `usetheodev`
 * is a USER, so it returned 403 for every token regardless of power. A gate whose oracle cannot tell
 * apart the failure it screens for is worse than no gate: it produces confident, wrong verdicts.
 */

const READY = { whoami: 'usetheodev', hasWritePathCredential: true }
const READ_PATH_ONLY = { whoami: 'usetheodev', hasWritePathCredential: false }
const ANONYMOUS = { whoami: undefined, hasWritePathCredential: false }

describe('diagnoseCredential — the three states a release must tell apart', () => {
  it('test_a_credential_on_the_write_path_is_accepted', () => {
    expect(diagnoseCredential(READY).publishable).toBe(true)
  })

  it('test_authentication_alone_is_NOT_enough', () => {
    // The trap, asserted directly. `whoami` succeeds for a credential the publish request never
    // sees; a preflight that stopped at authentication would green-light exactly the release that
    // failed.
    expect(diagnoseCredential(READ_PATH_ONLY).publishable).toBe(false)
  })

  it('test_the_refusal_explains_the_404_that_would_follow', () => {
    // Without this sentence the operator sees a 404 and concludes the token lacks permission —
    // which is precisely the wrong conclusion this gate was built on the first time.
    const reason = diagnoseCredential(READ_PATH_ONLY).reason
    expect(reason).toMatch(/404/)
    expect(reason).toMatch(/403/)
    expect(reason).toMatch(/anonymous/i)
  })

  it('test_the_refusal_names_the_fix', () => {
    const reason = diagnoseCredential(READ_PATH_ONLY).reason
    expect(reason).toMatch(/npmrc/i)
    expect(reason).toMatch(/NODE_AUTH_TOKEN/)
  })

  it('test_an_absent_credential_is_refused_differently', () => {
    // Different fixes: one needs a credential at all, the other needs it in a place the write path
    // reads. Collapsing them would send half the operators down the wrong path — the mistake this
    // gate itself made.
    const d = diagnoseCredential(ANONYMOUS)
    expect(d.publishable).toBe(false)
    // And it does not claim the credential is ABSENT: a configured-but-invalid token looks
    // identical to a missing one from `whoami`, and saying "not configured" would send an operator
    // whose secret exists looking for the wrong problem. Measured in CI: `NPM_TOKEN` is set and
    // `whoami` still fails.
    expect(d.reason).toMatch(/whoami/i)
    expect(d.reason).toMatch(/does not authenticate|expired|revoked/i)
    expect(d.reason).not.toMatch(/anonymous/i)
  })
})

describe('npmrcCandidates — where the publish request actually looks', () => {
  it('test_NPM_CONFIG_USERCONFIG_comes_first', () => {
    // The one that matters in CI: `actions/setup-node` writes its generated npmrc to a temp path and
    // points this variable at it. The first version of this probe looked only at `cwd` and `$HOME`,
    // so it reported "no npmrc" on a runner that had one — and refused a release whose credential
    // was perfectly fine. Third time on this same problem that a probe of mine was the wrong oracle,
    // which is why the path list is a tested function now instead of a detail inside a filesystem
    // call.
    const paths = npmrcCandidates(
      { NPM_CONFIG_USERCONFIG: '/runner/_temp/.npmrc' },
      '/repo',
      '/home/u',
    )
    expect(paths[0]).toBe('/runner/_temp/.npmrc')
  })

  it('test_project_and_home_are_still_consulted', () => {
    const paths = npmrcCandidates({}, '/repo', '/home/u')
    expect(paths).toEqual(['/repo/.npmrc', '/home/u/.npmrc'])
  })

  it('test_an_empty_USERCONFIG_is_ignored_rather_than_probed_as_a_path', () => {
    // An unset variable often arrives as the empty string; treating it as a path would check `.` and
    // could report a false positive from an unrelated file.
    expect(npmrcCandidates({ NPM_CONFIG_USERCONFIG: '' }, '/repo', '/home/u')).toEqual([
      '/repo/.npmrc',
      '/home/u/.npmrc',
    ])
  })
})
