#!/usr/bin/env node
/**
 * Is the npm credential on the WRITE path? — asked before the release (backlog B-M67-08).
 *
 * ## The failure this closes, and the wrong diagnosis it first produced
 *
 * The M67 release ran end to end — build, version, tag, GitHub release — and died on the last step
 * with `E404 Not Found - PUT https://registry.npmjs.org/@theokit%2fagents`. Nothing was published,
 * while `main` kept a tag and a CHANGELOG claiming three new versions.
 *
 * The first version of this script diagnosed that as a read-only token, and was **wrong**. Three
 * different tokens were declared read-only; all three could publish. The actual cause was the shape
 * of the credential, not its authority: it was being passed as an
 * `npm_config_//registry.npmjs.org/:_authToken=…` environment variable, which npm honours on READS —
 * `whoami` and `owner ls` both succeeded — and does not apply on the WRITE path. The `PUT` therefore
 * went out anonymous, and npm answers an unauthenticated write with **404 rather than 403** so it
 * does not leak whether a package exists.
 *
 * That 404 is why the misdiagnosis was so easy: the registry deliberately returns the same status
 * for "you may not" and "you are nobody".
 *
 * ## What this checks now
 *
 * The one thing that actually failed: whether the credential is visible on the write path, which is
 * what a canonical `.npmrc` entry (or `setup-node`'s generated one, fed by `NODE_AUTH_TOKEN`)
 * guarantees and an ad-hoc env var does not.
 *
 * It deliberately does NOT try to infer authority. The previous attempt did, using
 * `npm access list packages <name>` — an ORG endpoint, while `usetheodev` is a USER, so it returned
 * 403 for every token regardless of power. A gate whose oracle cannot distinguish the failure it
 * screens for is worse than no gate: it produces confident, wrong verdicts, and this one sent three
 * tokens to the bin.
 *
 * ## § PATH note
 *
 * `npm` runs from PATH deliberately: a release script asks the same npm the release uses.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/**
 * @typedef {{ whoami: string | undefined, hasWritePathCredential: boolean }} CredentialProbes
 * @typedef {{ publishable: boolean, reason: string }} CredentialDiagnosis
 */

/**
 * Turn the probes into a verdict.
 *
 * Pure, with the probes injected (DIP). The rule worth reviewing is the second clause: authentication
 * proves the credential is VALID, never that it reaches the publish request.
 *
 * @param {CredentialProbes} probes
 * @returns {CredentialDiagnosis}
 */
export function diagnoseCredential({ whoami, hasWritePathCredential }) {
  if (whoami === undefined || whoami.length === 0) {
    return {
      publishable: false,
      reason:
        '`npm whoami` failed: either no credential is configured, or the one that is does not ' +
        'authenticate (expired, revoked, or the wrong registry). Both look identical from here, so ' +
        'check in this order — is `NODE_AUTH_TOKEN` set for this step, does an npmrc name the ' +
        'registry, and is the token still valid on npmjs.com? A stored secret existing is not the ' +
        'same as it working, which is exactly how a release reaches its last step before finding out.',
    }
  }
  if (!hasWritePathCredential) {
    return {
      publishable: false,
      reason:
        `authenticated as \`${whoami}\`, but no \`_authToken\` is configured in an npmrc. That ` +
        `combination is the trap this gate exists for: npm honours an ad-hoc ` +
        `\`npm_config_//registry…:_authToken\` env var on READS, so \`whoami\` succeeds, and ` +
        `ignores it on the WRITE path — the publish goes out anonymous and the registry answers ` +
        `**404, not 403**, because it will not leak whether the package exists. Put the token in an ` +
        `npmrc (\`//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\`) or use ` +
        `\`actions/setup-node\`'s \`NODE_AUTH_TOKEN\`.`,
    }
  }
  return {
    publishable: true,
    reason: `authenticated as \`${whoami}\`, credential on the write path`,
  }
}

/** `npm whoami` — succeeds for any valid credential, on the read path. */
function probeWhoami() {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
    return execFileSync('npm', ['whoami'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return undefined
  }
}

/**
 * Every npmrc the publish request could read, in npm's own precedence order.
 *
 * `NPM_CONFIG_USERCONFIG` comes FIRST and is the one that matters in CI: `actions/setup-node` writes
 * its generated npmrc to a temp path and points that variable at it. A check that only looked at
 * `cwd` and `$HOME` therefore reported "no npmrc" on a runner that had one — which is exactly what
 * this gate did on its first real run, refusing a release whose credential was fine.
 *
 * That is the third time on this same problem that a probe of mine was the wrong oracle. Hence the
 * extraction: the path list is now a pure function with a test, instead of a detail buried in a
 * filesystem call.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 * @param {string} home
 * @returns {string[]}
 */
export function npmrcCandidates(env, cwd, home) {
  const candidates = []
  if (env.NPM_CONFIG_USERCONFIG !== undefined && env.NPM_CONFIG_USERCONFIG.length > 0) {
    candidates.push(env.NPM_CONFIG_USERCONFIG)
  }
  candidates.push(join(cwd, '.npmrc'), join(home, '.npmrc'))
  return candidates
}

/** Is an `_authToken` configured through an npmrc, rather than only an ad-hoc env var? */
function probeWritePathCredential() {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
    const value = execFileSync('npm', ['config', 'get', '//registry.npmjs.org/:_authToken'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (value.length > 0 && value !== 'undefined' && value !== 'null') return true
  } catch {
    /* fall through to the file check */
  }
  // `npm config get` masks some values, and `setup-node` writes a `${NODE_AUTH_TOKEN}` placeholder
  // that it may not expand for a read. An npmrc naming the registry counts.
  for (const rc of npmrcCandidates(process.env, process.cwd(), homedir())) {
    if (existsSync(rc) && readFileSync(rc, 'utf8').includes('registry.npmjs.org')) return true
  }
  return false
}

if (process.argv[1]?.endsWith('verify-publish-credential.mjs')) {
  const diagnosis = diagnoseCredential({
    whoami: probeWhoami(),
    hasWritePathCredential: probeWritePathCredential(),
  })
  if (!diagnosis.publishable) {
    console.error(`\nPublish preflight: REFUSED — ${diagnosis.reason}\n`)
    console.error(
      'Refusing here rather than after the release: a publish that fails at the last step leaves a ' +
        'tag and a CHANGELOG claiming versions the registry never received.\n',
    )
    process.exit(1)
  }
  console.log(`Publish preflight: OK — ${diagnosis.reason}`)
}
