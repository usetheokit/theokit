/**
 * Refuse a built tree in which a package emitted JavaScript and none of the types it declares.
 *
 * The reasoning, the measurement and why `publint` is not this mechanism are in
 * `scripts/lib/dts-completeness.ts`. This file only decides where the check runs and what it exits.
 *
 * ## Why it runs after the build rather than at every import
 *
 * The state it catches is produced once, by a build that did not finish, and then persists — `dist`
 * is gitignored, so nothing makes it visible again. Checking at import time would pay for that
 * discovery on every module resolution to catch a condition that changes only when a build runs.
 * This is the cheapest point at which the answer can still change.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditWorkspaceDts, describeDtsFinding, type DtsFinding } from './lib/dts-completeness.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const findings = auditWorkspaceDts(REPO_ROOT)
const incomplete = findings.filter(
  (finding): finding is Extract<DtsFinding, { kind: 'types-missing' }> =>
    finding.kind === 'types-missing',
)

if (incomplete.length === 0) {
  const complete = findings.filter((f) => f.kind === 'complete').length
  const unbuilt = findings.filter((f) => f.kind === 'not-built').length
  const untyped = findings.filter((f) => f.kind === 'types-not-declared').length
  // The counts are printed on success too: "checked nothing" and "checked and found nothing" are
  // different results, and a bare ✓ cannot tell them apart.
  console.log(
    `✓ [check-dts-complete] ${String(complete)} package(s) carry every type entry they declare` +
      ` (${String(unbuilt)} not built, ${String(untyped)} declare no types).`,
  )
  process.exit(0)
}

for (const finding of incomplete) {
  console.error(describeDtsFinding(finding))
  console.error('')
}
console.error(
  `✗ [check-dts-complete] ${String(incomplete.length)} package(s) emitted JavaScript without their declared types.`,
)
process.exit(1)
