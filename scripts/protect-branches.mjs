#!/usr/bin/env node
/**
 * Branch protection as a versioned, checkable artifact (backlog B-M67-10).
 *
 * ## Why
 *
 * `CLAUDE.md` § 4 and `git-safety.md` § 1 say the same thing twice: the local hook guarantees work is
 * BORN on `workspace`; **branch protection is what makes the PR mandatory**. This repository has the
 * first guarantee and not the second — `git push origin main` works today, and two consecutive
 * releases merged with twelve red checks partly because nothing on the server side said no.
 *
 * The intended policy lived only in the prose of issue #208. Prose cannot be diffed against reality,
 * so "does the repo match what we decided?" had no answer short of opening a settings page. The spec
 * now lives in `.github/branch-protection.json`, this script compares it against the live API, and
 * `--apply` is the only way it ever writes.
 *
 * ## Read-only by default, on purpose
 *
 * Applying branch protection is an administrative change to a shared repository. The default mode
 * REPORTS the difference and exits non-zero; writing requires `--apply` explicitly. A tool that
 * mutates a security setting as a side effect of being run is the wrong shape regardless of how
 * correct the setting is.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'usetheodev/theokit'

/** The intended policy, versioned next to the workflows it protects. */
export const SPEC = JSON.parse(readFileSync(join(ROOT, '.github/branch-protection.json'), 'utf8'))

/**
 * @typedef {{ matches: boolean, differences: string[] }} ProtectionDiff
 */

/**
 * Compare the desired policy for one branch against what the server reports.
 *
 * `live === null` means the API answered 404 — the branch is not protected at all.
 *
 * Pure, with the live state injected (DIP), so the comparison is testable without touching a real
 * repository. That matters more than usual here: a bug in this function would either hide real drift
 * or invent it, and both push somebody toward editing a security setting for the wrong reason.
 *
 * @param {string} branch
 * @param {Record<string, any>} desired
 * @param {Record<string, any> | null} live
 * @returns {ProtectionDiff}
 */
export function diffProtection(branch, desired, live) {
  if (live === null) {
    return { matches: false, differences: [`\`${branch}\` is not protected at all`] }
  }

  const differences = []

  const wantsReview = desired.required_pull_request_reviews !== null
  const hasReview = live.required_pull_request_reviews != null
  if (wantsReview && !hasReview) {
    differences.push(
      `\`${branch}\`: a pull request is not required (the whole point of the policy)`,
    )
  }

  // Checked before force-push and deletions because it governs whether ANY of them bind: an exempt
  // administrator is not restricted by the rest of the policy. The first application of this spec
  // set it to `false` and this comparator did not read the field, so it printed `✓ matches the spec`
  // over a policy that bound nobody in a single-maintainer repository.
  if (desired.enforce_admins === true && live.enforce_admins?.enabled !== true) {
    differences.push(
      `\`${branch}\`: administrators are exempt, so the policy does not bind the one person who ` +
        'can push here',
    )
  }

  if (desired.allow_force_pushes === false && live.allow_force_pushes?.enabled === true) {
    differences.push(`\`${branch}\`: force-push is still allowed`)
  }
  if (desired.allow_deletions === false && live.allow_deletions?.enabled === true) {
    differences.push(`\`${branch}\`: branch deletion is still allowed`)
  }

  const wantContexts = desired.required_status_checks?.contexts ?? []
  const liveContexts = live.required_status_checks?.contexts ?? []
  for (const context of wantContexts) {
    if (!liveContexts.includes(context)) {
      differences.push(`\`${branch}\`: required check missing on the server — ${context}`)
    }
  }
  for (const context of liveContexts) {
    if (!wantContexts.includes(context)) {
      // Drift in either direction is drift: a context nobody put in the spec is a rule nobody reviewed.
      differences.push(`\`${branch}\`: required check present but not in the spec — ${context}`)
    }
  }

  return { matches: differences.length === 0, differences }
}

/** Live protection for a branch, or `null` when the API says it is unprotected. */
function fetchProtection(branch) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the repo's own gh CLI
    const raw = execFileSync('gh', ['api', `repos/${REPO}/branches/${branch}/protection`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function applyProtection(branch, desired) {
  const body = JSON.stringify(desired)
  execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the repo's own gh CLI, already authenticated
    'gh',
    ['api', '-X', 'PUT', `repos/${REPO}/branches/${branch}/protection`, '--input', '-'],
    {
      input: body,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

if (process.argv[1]?.endsWith('protect-branches.mjs')) {
  const apply = process.argv.includes('--apply')
  let drifted = false

  for (const [branch, desired] of Object.entries(SPEC.branches)) {
    const diff = diffProtection(branch, desired, fetchProtection(branch))
    if (diff.matches) {
      console.log(`✓ ${branch}: matches the spec`)
      continue
    }
    drifted = true
    for (const line of diff.differences) console.log(`✗ ${line}`)
    if (apply) {
      applyProtection(branch, desired)
      console.log(`  → applied the spec to \`${branch}\``)
    }
  }

  if (drifted && !apply) {
    console.log(
      '\nRead-only run. `pnpm protect:branches --apply` writes the spec.\n' +
        'Applying branch protection is an administrative change to a shared repository, so it is ' +
        'never a side effect of merely running this.',
    )
    process.exit(1)
  }
}
