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
import { existsSync } from 'node:fs'
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
        'no npm credential is configured (npm whoami failed). Set NODE_AUTH_TOKEN with ' +
        '`actions/setup-node`, or run `npm login`.',
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
 * Is an `_authToken` configured through an npmrc, rather than only an ad-hoc env var?
 *
 * `npm config get` resolves the full npmrc chain (user, project, `NPM_CONFIG_USERCONFIG`), which is
 * the same resolution the publish request uses.
 */
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
  // `npm config get` masks some values; a project or home npmrc naming the registry counts too.
  for (const rc of [join(process.cwd(), '.npmrc'), join(homedir(), '.npmrc')]) {
    if (existsSync(rc)) return true
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
