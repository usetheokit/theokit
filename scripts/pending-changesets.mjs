#!/usr/bin/env node
/**
 * Does this repository have changesets waiting? Prints `true` or `false`, nothing else.
 *
 * ## Why the release workflow asks a script instead of a glob
 *
 * A release run has two mutually exclusive branches: with pending changesets it produces the
 * "Version Packages" commit; without them it publishes. `changesets/action` decides that internally
 * and, on the version branch, tries to OPEN A PULL REQUEST — which this organization forbids
 * (`can_approve_pull_request_reviews=false` on all ten repositories AND at the org level, measured
 * 2026-08-23). The run fails there, and never reaches publish (usetheokit/theokit#191).
 *
 * So the decision moves out of the action and into the workflow, and this is the decision.
 *
 * It is a script rather than a shell one-liner because a wrong answer sends a release down the
 * wrong branch. `.changeset/` ships with `README.md` and `config.json`, and a glob that counted
 * either would answer `true` forever — versioning on every run and never publishing.
 *
 * A repository with no `.changeset/` at all answers `false` rather than failing: not using
 * changesets is not an error, it just means nothing is pending.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** Files that live in `.changeset/` and are not changesets. */
const NOT_A_CHANGESET = new Set(['README.md', 'config.json'])

/**
 * Names `changeset version` has already APPLIED, which in prerelease mode keep their files.
 *
 * Outside pre mode a consumed changeset is deleted, so counting `.md` files answers "is a version
 * bump pending". Inside pre mode the file stays and its name is recorded in `pre.json`, because the
 * bump has to be recomputed at `pre exit` — so the same count answers "has a changeset ever been
 * written", which is a different question and is true forever.
 *
 * Measured on usetheokit/theokit#618, the first cut of this package on the `next` channel: after
 * the version pull request merged, this reported `true`, the workflow re-ran `pnpm version-packages`
 * against a tree that already carried the bump, and `verify-version-not-published` correctly refused
 * — "no package differs from origin/main". The release failed at the version step, so the publish
 * step, which is gated on this being `false`, never ran. The version reached `main` and never
 * reached the registry.
 */
function consumed() {
  const pre = '.changeset/pre.json'
  if (!existsSync(pre)) return new Set()
  try {
    return new Set(JSON.parse(readFileSync(pre, 'utf8')).changesets ?? [])
  } catch {
    // Corruption is not "nothing is consumed": that reading re-runs the version step against a tree
    // that may already carry the bump, which is the failure above.
    throw new Error('.changeset/pre.json exists but is not valid JSON')
  }
}

function pending() {
  let entries
  try {
    entries = readdirSync('.changeset', { withFileTypes: true })
  } catch {
    return false
  }
  const applied = consumed()
  return entries.some(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      !NOT_A_CHANGESET.has(entry.name) &&
      !applied.has(entry.name.replace(/\.md$/u, '')),
  )
}

// One word, no newline decoration beyond the single terminator: the workflow assigns this straight
// into `$GITHUB_OUTPUT`, and anything extra makes the comparison fail silently.
process.stdout.write(`${String(pending())}\n`)
