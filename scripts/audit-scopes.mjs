#!/usr/bin/env node
/**
 * Dependency-audit gate, with the scope split made explicit (backlog B-M67-11).
 *
 * ## The gap
 *
 * `check:audit` ran `pnpm audit --prod --audit-level=high` and nothing else. That choice is
 * defensible — a high CVE in a production dependency ships to every consumer of the framework, one
 * in `eslint` does not — but it was never *stated*, so the development-side number simply went
 * unmeasured. Measured for the first time on 2026-08-12: `--prod` reports 6 advisories and **zero
 * high**; the full tree reports 23 with **16 high**, every one of them an algorithmic-complexity /
 * DoS issue inside build tooling.
 *
 * ## Why the asymmetry, and why it is not laziness
 *
 * Those 16 arrive transitively and cannot be fixed from here — they need upstream releases. Blocking
 * on them would make the gate permanently red, which is the exact failure this repository spent a
 * cycle undoing: a gate nobody can satisfy is a gate nobody reads, and the next REAL finding then
 * arrives indistinguishable from the noise.
 *
 * So: production blocks, development is surfaced. Not blocking must never mean not knowing.
 *
 * ## § PATH note
 *
 * `pnpm` is invoked from PATH, deliberately: an audit script asks the same package manager the build
 * uses. An absolute path would pin one installation and closes no threat a build script does not
 * already have.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

/** @typedef {{ critical: number, high: number, moderate: number, low: number }} SeverityCounts */

const SEVERITIES = ['critical', 'high', 'moderate', 'low']

/**
 * Count advisories by severity in a `pnpm audit --json` payload.
 *
 * A clean tree emits `{}`, so an absent `advisories` map counts zero rather than throwing — treating
 * the healthiest possible state as a parse failure would break the gate precisely when it should be
 * quietest. An unrecognised severity is ignored rather than folded into a neighbour, because a
 * miscount here is worse than a gap: it would move a number the operator acts on.
 *
 * @param {{ advisories?: Record<string, { severity?: string }> }} report
 * @returns {SeverityCounts}
 */
export function summarizeBySeverity(report) {
  /** @type {SeverityCounts} */
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 }
  for (const advisory of Object.values(report?.advisories ?? {})) {
    const severity = advisory?.severity
    if (severity !== undefined && SEVERITIES.includes(severity)) {
      counts[severity] += 1
    }
  }
  return counts
}

/**
 * @typedef {{ blocking: boolean, reason: string, warnings: string[] }} AuditOutcome
 */

/**
 * Decide the gate's outcome from the two scopes.
 *
 * Pure, with both counts injected (DIP): the CLI runs `pnpm audit` twice, the tests pass literals.
 * Keeping the decision out of the process call is what makes "which scope blocks" a reviewable
 * statement instead of a flag buried in a package script.
 *
 * `pnpm audit` without `--prod` covers BOTH trees, so the development-only figure is the difference.
 * Reporting the raw full-tree number would tell the operator there are dev issues that are in fact
 * the production ones already blocking above — a double count that erodes trust in the report.
 *
 * @param {{ prod: SeverityCounts, dev: SeverityCounts }} scopes
 * @returns {AuditOutcome}
 */
export function decideAuditOutcome({ prod, dev }) {
  const prodBlocking = prod.critical + prod.high
  if (prodBlocking > 0) {
    return {
      blocking: true,
      reason:
        `${prodBlocking} critical/high advisory(ies) in PRODUCTION dependencies — these ship to ` +
        `every consumer of the framework`,
      warnings: [],
    }
  }

  const devOnlyHigh = dev.critical + dev.high - prodBlocking
  const warnings =
    devOnlyHigh > 0
      ? [
          `${devOnlyHigh} critical/high advisory(ies) in DEV-only dependencies. Not blocking: they ` +
            `arrive transitively through build tooling and need upstream releases, so blocking ` +
            `would leave this gate permanently red. Reported so the number is known, never assumed.`,
        ]
      : []

  return {
    blocking: false,
    reason: 'no critical/high advisory in production dependencies',
    warnings,
  }
}

/**
 * Run one `pnpm audit` scope and return its severity counts.
 *
 * `execFileSync` with an argv array rather than a command string: no shell is spawned, so there is
 * no interpolation to get wrong. The arguments here are literals today, but a gate that builds a
 * shell string invites the day someone interpolates a variable into it.
 */
function auditScope(prodOnly) {
  const args = prodOnly ? ['audit', '--prod', '--json'] : ['audit', '--json']
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
    const raw = execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 1 << 26 })
    return summarizeBySeverity(JSON.parse(raw))
  } catch (err) {
    // `pnpm audit` exits non-zero when it FINDS something — the payload is still on stdout, and
    // treating a non-zero exit as a tool failure would make every dirty tree look like a broken gate.
    const stdout = /** @type {{ stdout?: string }} */ (err).stdout
    if (typeof stdout === 'string' && stdout.trim().length > 0) {
      try {
        return summarizeBySeverity(JSON.parse(stdout))
      } catch {
        /* fall through to the hard failure below */
      }
    }
    console.error(`Failed to run \`pnpm ${args.join(' ')}\`:`, /** @type {Error} */ (err).message)
    process.exit(2)
  }
}

if (process.argv[1]?.endsWith('audit-scopes.mjs')) {
  const prod = auditScope(true)
  const dev = auditScope(false)
  const outcome = decideAuditOutcome({ prod, dev })

  for (const warning of outcome.warnings) {
    // GitHub renders this in the PR UI. A warning nobody sees is the same as no measurement at all.
    console.log(`::warning::${warning}`)
  }

  if (outcome.blocking) {
    console.error(`Dependency audit: FAIL — ${outcome.reason}`)
    console.error(`  production: ${JSON.stringify(prod)}`)
    console.error(`  whole tree: ${JSON.stringify(dev)}`)
    process.exit(1)
  }

  console.log(`Dependency audit: OK — ${outcome.reason}`)
  console.log(`  production: ${JSON.stringify(prod)}`)
  console.log(`  whole tree: ${JSON.stringify(dev)}`)
}
