#!/usr/bin/env node
/**
 * #148 — turn the staleness CHECK into a staleness MECHANISM.
 *
 * `check-theokit-updates.mjs` has been accurate since it was written and nothing ran it. A tool
 * that only exists as an npm script holds exactly as long as somebody remembers to type it, which
 * is not a property of the repository — it is a property of whoever is paying attention that week.
 *
 * This runs it on a schedule and lands the answer where work is tracked: ONE issue, opened when a
 * pin falls behind the tag it tracks, updated as that set changes, closed when it catches up.
 *
 * ## Three states, and the third is why this file is careful
 *
 * The checker exits `0` current, `1` behind, `2` its own failure. Collapsing the third into either
 * of the others is the whole risk here:
 *
 *   - folded into "current", a broken check CLOSES the issue — reporting a problem as solved
 *     because nobody could measure it, which is the one inversion this repository files issues about;
 *   - folded into "behind", every npm outage opens an issue naming versions nobody read.
 *
 * So `2` is `unmeasured`: it never opens, never closes, never edits the body. It comments on an open
 * issue and exits non-zero so the scheduled run goes red where a human can see it. Absence of a
 * measurement does not become an assertion about the pins.
 *
 * ## Closing the issue is a decision, and it sticks (#159)
 *
 * Being behind is a fact, not a verdict: sometimes the right answer is to decline the version. The
 * first version of this file searched OPEN issues only, so a human who measured the delta and closed
 * the issue got it re-opened the following Monday — the stale-issue failure #148 named, inverted.
 * A closed issue carrying the same fingerprint now means "already decided", and only that
 * fingerprint stays quiet: declining 5.3.3 must never hide 5.4.0.
 *
 * ## Why an issue and not a failing build
 *
 * Stated by #148 before this existed: upstream publishing something is not a failure of this
 * repository's build, and a gate that fails for a reason its author cannot fix is a gate that gets
 * bypassed. A log line is barely better — a report nobody reads is the shape this repository files
 * issues about.
 *
 * ## Why the decision is a pure function
 *
 * `decide()` takes the checker's exit code, its parsed report, whatever issue is already open and
 * whatever fingerprint was last declined, and returns an action. It touches nothing. That is what makes the interesting cases — a check
 * that failed while an issue is open, a set that shrank but did not empty — testable without a
 * tracker, which is the same split `classifyRegistryOutcome` uses in `session-ops.ts`.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * The marker that makes this idempotent. Searched for in issue BODIES, never in titles.
 *
 * A title carries the package names, so it changes the moment the set does — and matching on it
 * would open a second issue for the same condition every time a package caught up. The marker is
 * invisible in rendered Markdown and stable forever.
 */
export const MARKER = '<!-- theokit-staleness-report -->'

export const TITLE = 'deps: a @theokit pin is behind the tag it tracks'

/** What the checker said, normalised into the only three answers this file acts on. */
export const CURRENT = 'current'
export const BEHIND = 'behind'
export const UNMEASURED = 'unmeasured'

/**
 * Classify the checker's own exit code.
 *
 * `1` means behind ONLY when the report actually names something behind. A `1` with no behind row
 * is the checker contradicting itself, and reading it as "behind" would produce an issue listing
 * nothing — so it is treated as unmeasured, which is what it is.
 */
export function classify(exitCode, report) {
  if (exitCode === 2 || report === null) return UNMEASURED
  const behind = behindRows(report)
  if (exitCode === 1) return behind.length > 0 ? BEHIND : UNMEASURED
  if (exitCode === 0) return behind.length > 0 ? UNMEASURED : CURRENT
  return UNMEASURED
}

export function behindRows(report) {
  if (!report || !Array.isArray(report.rows)) return []
  return report.rows.filter((r) => r && r.current === false)
}

/** A stable identity for "which packages are behind, at which versions". */
export function fingerprint(rows) {
  return rows
    .map((r) => `${String(r.name)}@${String(r.installed)}->${String(r.latest)}`)
    .sort()
    .join(' ')
}

/**
 * Decide what to do, given the world.
 *
 * `existing` is the open issue carrying {@link MARKER}, or `null`. Returning an action rather than
 * performing one is what lets the tests cover the case that actually bites — a failed check while
 * an issue is open — without a tracker or a network.
 */
export function decide({ exitCode, report, existing, declined = null }) {
  const state = classify(exitCode, report)

  if (state === UNMEASURED) {
    // Never `close`, never `open`, never `edit`. The check could not answer; the pins are unchanged
    // and unexamined, and both of those are true at once.
    return existing
      ? { action: 'comment-unmeasured', number: existing.number, state }
      : { action: 'none', state }
  }

  if (state === CURRENT) {
    return existing ? { action: 'close', number: existing.number, state } : { action: 'none', state }
  }

  const rows = behindRows(report)
  const print = fingerprint(rows)
  // #159 — a human who measured this exact delta and closed the issue has DECIDED. Re-opening it
  // every Monday overrides that decision on a schedule, which is the stale-issue failure #148
  // named, inverted: an issue that will not stay closed gets muted exactly like one that never
  // changes. The fingerprint is what keeps the silence narrow — declining 5.3.3 must not hide
  // 5.4.0, so only the SAME versions stay quiet.
  //
  // This is checked BEFORE `existing`, and that ordering is the fix for #163. Checked after, a
  // state that RETURNS to a declined one while an issue is open is `edit` — the issue is rewritten
  // to describe versions a human already declined, and then stays open forever describing a
  // decision that was taken. Measured: with an upstream `latest` tag moved and then restored, the
  // issue opened for the new fact (correct) and would never have closed again (not).
  if (declined !== null && declined === print) {
    return existing
      ? { action: 'close-declined', number: existing.number, fingerprint: print, state }
      : { action: 'declined', fingerprint: print, state }
  }
  if (!existing) return { action: 'open', rows, fingerprint: print, state }
  // Only touch the issue when the ANSWER changed. Rewriting an identical body on every scheduled
  // run makes "last updated" mean "the cron fired", and an issue whose timestamp moves for no
  // reason is one people stop reading — the stale-issue failure #148 named before this was built.
  if (existing.fingerprint === print) return { action: 'unchanged', number: existing.number, state }
  return { action: 'edit', number: existing.number, rows, fingerprint: print, state }
}

/** The issue body. Carries the marker and the fingerprint so the next run can read both back. */
export function renderBody(rows, { now }) {
  const major = rows.filter((r) => r.major)
  const lines = [
    MARKER,
    `<!-- fingerprint: ${fingerprint(rows)} -->`,
    '',
    `${String(rows.length)} \`@theokit/*\` ${rows.length === 1 ? 'pin is' : 'pins are'} behind the tag ` +
      'it tracks. This repository pins theokit **exactly and on purpose** — prereleases are the ' +
      'default because TheoCode is the consumer that exercises theokit — so a pin never drifts ' +
      'upward on its own, and nothing else would ever say a fix landed.',
    '',
    '| package | pinned | published | tag | major | declared by |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => {
      const decl = (r.declarations ?? [])
        .map((d) => `${String(d.label)} \`${String(d.range)}\``)
        .join(', ')
      return (
        `| \`${String(r.name)}\` | ${String(r.installed)} | **${String(r.latest)}** | ` +
        `${String(r.channel)} | ${r.major ? '**yes**' : 'no'} | ${decl} |`
      )
    }),
    '',
  ]

  if (major.length > 0) {
    lines.push(
      `⚠️ ${String(major.length)} of these is a **major**. Read its changelog before taking it — ` +
        'a major that only breaks in a path the suite does not exercise is exactly the shape this ' +
        'repository has been bitten by, and the exact pin exists so that decision is deliberate.',
      '',
    )
  }

  lines.push(
    '## Taking it',
    '',
    '```bash',
    'pnpm deps:theokit          # the same check, with the reasoning',
    'pnpm -w up <package>@<version> --save-exact',
    'pnpm test && pnpm lint     # then verify from a clean clone of the tag you cut',
    '```',
    '',
    'Being behind is not a defect and not urgent by itself — it is a fact that had no home before ' +
      'this issue. It closes itself once the pins catch up.',
    '',
    '**Declining is a valid answer.** If you measure the delta and decide this version is not worth ' +
      'taking, close this issue: the scheduled run reads closed issues too, and will not re-open ' +
      'these exact versions. A newer one still opens a fresh issue.',
    '',
    `<sub>Opened by \`tools/report-theokit-staleness.mjs\` (#148). Last measured ${now}.</sub>`,
  )
  return lines.join('\n')
}

/** Read the fingerprint back out of an issue body. `null` when the body predates the convention. */
export function readFingerprint(body) {
  const m = /<!-- fingerprint: (.*?) -->/.exec(body ?? '')
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// I/O — everything below talks to a process or to the tracker.
// ---------------------------------------------------------------------------

function gh(args, { repo }) {
  return execFileSync('gh', repo ? [...args, '-R', repo] : args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
}

/** Run the checker. Its exit code IS the contract; a throw carries it on `err.status`. */
export function runChecker(root) {
  const script = join(root, 'tools', 'check-theokit-updates.mjs')
  try {
    const out = execFileSync(process.execPath, [script, '--json'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    return { exitCode: 0, report: parse(out) }
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status : 2
    return { exitCode: status, report: parse(err?.stdout) }
  }
}

function parse(out) {
  if (typeof out !== 'string' || out.trim() === '') return null
  try {
    return JSON.parse(out)
  } catch {
    // Unparseable output is not "current". It is the checker having failed in a way its exit code
    // did not describe, and `classify` turns a null report into `unmeasured` for exactly that.
    return null
  }
}

function marked(raw) {
  return JSON.parse(raw).filter((i) => typeof i.body === 'string' && i.body.includes(MARKER))
}

export function findExisting({ repo }) {
  const hits = marked(
    gh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,body'], { repo }),
  )
  const hit = hits[0]
  return hit ? { number: hit.number, fingerprint: readFingerprint(hit.body) } : null
}

/**
 * The fingerprint on the most recently closed staleness issue, or `null`.
 *
 * `--state closed` is the query the first version of this file did not make, which is exactly how a
 * human's decision became invisible to it (#159). `gh issue list` returns newest first, so the head
 * is the last decision anyone took.
 */
export function findDeclined({ repo }) {
  const hits = marked(
    gh(['issue', 'list', '--state', 'closed', '--limit', '20', '--json', 'number,body'], { repo }),
  )
  return hits.length > 0 ? readFingerprint(hits[0].body) : null
}

function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const repoIdx = argv.indexOf('--repo')
  const repo = repoIdx >= 0 ? argv[repoIdx + 1] : undefined
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const now = new Date().toISOString().slice(0, 10)

  const { exitCode, report } = runChecker(root)
  const existing = dryRun && !repo ? null : findExisting({ repo })
  const declined = existing || (dryRun && !repo) ? null : findDeclined({ repo })
  const plan = decide({ exitCode, report, existing, declined })

  console.log(`checker exit ${String(exitCode)} → ${plan.state} → ${plan.action}`)

  if (dryRun) {
    if (plan.rows) console.log('\n' + renderBody(plan.rows, { now }))
    // A dry run reports the plan and asserts nothing about the pins, so it exits 0 even when the
    // state is `unmeasured` — the caller asked what WOULD happen, and it answered.
    return 0
  }

  switch (plan.action) {
    case 'open': {
      const url = gh(
        ['issue', 'create', '--title', TITLE, '--body', renderBody(plan.rows, { now })],
        { repo },
      ).trim()
      console.log(url)
      return 0
    }
    case 'edit': {
      gh(
        ['issue', 'edit', String(plan.number), '--body', renderBody(plan.rows, { now })],
        { repo },
      )
      // A comment only when the SET changed, which `edit` already means. Editing the body moves
      // nothing into anyone's inbox; the comment is what tells a subscriber a new version landed.
      gh(
        [
          'issue',
          'comment',
          String(plan.number),
          '--body',
          `Set changed — now ${fingerprint(plan.rows)}`,
        ],
        { repo },
      )
      console.log(`updated #${String(plan.number)}`)
      return 0
    }
    case 'close': {
      gh(
        [
          'issue',
          'comment',
          String(plan.number),
          '--body',
          'Every `@theokit/*` pin is current on the tag it tracks. Closing; this reopens on its own ' +
            'the next time one falls behind.',
        ],
        { repo },
      )
      gh(['issue', 'close', String(plan.number), '--reason', 'completed'], { repo })
      console.log(`closed #${String(plan.number)}`)
      return 0
    }
    case 'comment-unmeasured': {
      gh(
        [
          'issue',
          'comment',
          String(plan.number),
          '--body',
          `The scheduled check could not run on ${now} (exit ${String(exitCode)}), so this issue is ` +
            'neither updated nor closed. What it lists was true when last measured; whether it is ' +
            'true now is unknown.',
        ],
        { repo },
      )
      console.error('checker failed; issue left untouched')
      return 1
    }
    case 'close-declined': {
      gh(
        [
          'issue',
          'comment',
          String(plan.number),
          '--body',
          `The pins are back to a state already declined (\`${String(plan.fingerprint)}\`), so the ` +
            'decision taken then still applies. Closing; a version nobody has ruled on still opens ' +
            'a fresh issue.',
        ],
        { repo },
      )
      gh(['issue', 'close', String(plan.number), '--reason', 'not planned'], { repo })
      console.log(`closed #${String(plan.number)} — returned to a declined state`)
      return 0
    }
    case 'declined':
      // Nothing to say. Saying it anyway — a comment, a reopen, a log line somebody has to dismiss
      // — is what turns a mechanism into noise.
      console.log(`already declined: ${String(plan.fingerprint)}`)
      return 0
    case 'none':
      return plan.state === UNMEASURED ? 1 : 0
    default:
      return 0
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main())
  } catch (err) {
    console.error(`report-theokit-staleness failed: ${String(err?.message ?? err)}`)
    process.exit(2)
  }
}
