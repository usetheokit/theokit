#!/usr/bin/env node
/**
 * Release-record guard — the root CHANGELOG is not older than what was published.
 *
 * ## Why a gate and not discipline
 *
 * Two changelog systems live here with different owners, and only one of them runs by itself.
 * `changeset version` rewrites `packages/<name>/CHANGELOG.md` on every release; the root file is
 * hand-maintained in Keep-a-Changelog form, and nothing in the release chain touches it. So the
 * root file cannot drift a little — it drifts by exactly as much as nobody remembers.
 *
 * Measured on 2026-08-25 (usetheokit/theokit#462): the newest section named `theokit 0.49.0` while
 * six releases had shipped since, and `[Unreleased]` had grown to 115 entries. Nothing failed,
 * because nothing compared the two.
 *
 * ## What it checks
 *
 * The newest release tag must be NAMED by a dated section of `CHANGELOG.md`. That is the whole
 * invariant: a release that shipped without reaching the record.
 *
 * ## What it deliberately does not check
 *
 * - Whether the record is any GOOD. A section can be dated today and say nothing useful; no gate
 *   can see that, and pretending otherwise would make a green run mean more than it does.
 * - Per-version completeness. A release may legitimately land inside a section that names several
 *   versions, which is how a same-day batch is recorded.
 * - Whether every OLDER release is recorded. The check is about the newest one; a hole further
 *   back stays a hole, and finding it is archaeology rather than a gate.
 *
 * Day granularity USED to be the resolution, and it was stated here as a known limit: a release and
 * its record on the same day always agreed, so a same-day omission was invisible. That limit cost a
 * real omission on 2026-08-28 — `theokit@0.58.1` and `theokit@0.59.0` both shipped that day, the
 * record named only the first, and this gate was green. Three releases in two days is this
 * repository's ordinary pace, so the case was not exotic.
 *
 * The comparison is now on IDENTITY, not date: the newest tag's `name@version` must appear in some
 * dated heading. Strictly stronger, and it removes the limit rather than restating it.
 *
 * Exits 1 when the record is behind, 0 when it is current, and 0 with a stated reason when it could
 * not read the tags — a run that could not measure must not report a pass it did not earn.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `theokit@0.52.1`, `create-theokit@1.23.11`, `@theokit/agents@11.0.0` — not `v1.0.0`. */
const RELEASE_TAG = /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+@\d+\.\d+\.\d+/

/** `git tag` argv, hoisted so the call below fits on one line — see the directive there. */
const TAG_ARGV = ['tag', '--sort=-creatordate', '--format=%(refname:short) %(creatordate:short)']

/** The newest release tag and the day it was created, or null when git cannot answer. */
function newestReleaseTag() {
  const opts = { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  let raw
  try {
    // The directive must sit on the line IMMEDIATELY above the command literal. It did not: with
    // the argv inline, prettier split the call and `'git'` landed two lines down, so the directive
    // covered nothing and the rule fired anyway — two errors where the intent was zero.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    raw = execFileSync('git', TAG_ARGV, opts)
  } catch {
    return null
  }
  return firstReleaseTag(raw)
}

/** The first line of `git tag` output that names a release tag. */
function firstReleaseTag(raw) {
  for (const line of raw.split('\n')) {
    const [name, date] = line.trim().split(/\s+/)
    if (name && date && RELEASE_TAG.test(name)) return { name, date }
  }
  return null
}

/** A `## [...] - YYYY-MM-DD` heading. One definition, because two would drift. */
const DATED_SECTION = /^## .*?-\s*(\d{4}-\d{2}-\d{2})\s*$/

/** The newest dated heading, or null when the file carries none. Reported, not compared. */
function newestRecordedSection() {
  const text = readFileSync(resolve(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
  let newest = null
  for (const line of text.split('\n')) {
    const match = DATED_SECTION.exec(line)
    if (match && (newest === null || match[1] > newest.date)) {
      newest = { date: match[1], heading: line.trim() }
    }
  }
  return newest
}

const tag = newestReleaseTag()
const section = newestRecordedSection()

if (tag === null) {
  console.log(
    '⚠ [changelog] no release tags readable — the record was NOT compared against anything.',
  )
  process.exit(0)
}

if (section === null) {
  console.error(
    `✗ [changelog] CHANGELOG.md carries no dated section, and ${tag.name} shipped on ${tag.date}.`,
  )
  console.error('  Add a `## [<versions>] - YYYY-MM-DD` heading for what was released.')
  process.exit(1)
}

/**
 * Is this tag named by any dated heading?
 *
 * A tag is `theokit@0.59.0`; a heading writes it `theokit 0.59.0`, and may name several in one —
 * `## [theokit 0.58.0, @theokit/agents-pty 0.2.1] - 2026-08-27` — which is how a same-day batch is
 * recorded. Normalising the `@` before the version and asking whether the heading CONTAINS it
 * handles both shapes without parsing the list.
 */
function isRecorded(tagName) {
  const spelled = tagName.replace(/@(?=\d)/, ' ')
  return readFileSync(resolve(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
    .split('\n')
    .some((line) => DATED_SECTION.test(line) && line.includes(spelled))
}

if (!isRecorded(tag.name)) {
  console.error(`✗ [changelog] ${tag.name} shipped on ${tag.date} and no dated section names it.`)
  console.error(`    ${section.heading}`)
  console.error('')
  console.error('  A release reached the registry without reaching this file. Promote the entries')
  console.error('  from `[Unreleased]` into a dated section naming the versions that were cut.')
  console.error('  `changeset version` never touches this file — only a person does.')
  process.exit(1)
}

console.log(
  `✓ [changelog] the record is current — newest release ${tag.name} (${tag.date}), newest section ${section.date}.`,
)
