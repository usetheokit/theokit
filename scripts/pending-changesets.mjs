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
import { readdirSync } from 'node:fs'

/** Files that live in `.changeset/` and are not changesets. */
const NOT_A_CHANGESET = new Set(['README.md', 'config.json'])

function pending() {
  let entries
  try {
    entries = readdirSync('.changeset', { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some(
    (entry) => entry.isFile() && entry.name.endsWith('.md') && !NOT_A_CHANGESET.has(entry.name),
  )
}

// One word, no newline decoration beyond the single terminator: the workflow assigns this straight
// into `$GITHUB_OUTPUT`, and anything extra makes the comparison fail silently.
process.stdout.write(`${String(pending())}\n`)
