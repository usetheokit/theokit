#!/usr/bin/env node
/**
 * Run the two program instruments, `check-pillar-map.mjs` (OBJ-8's 33 pillars) and TheoClaw's
 * parity ledger (OBJ-6's 113 rows), and write their counts as markdown, to the job summary when
 * `GITHUB_STEP_SUMMARY` is set. `program-counts.yml` runs it on a schedule.
 *
 * ## What fails, and what does not
 *
 * Both checkers exit 1 while the program they measure is unfinished. That is the state being
 * reported, not a defect: decision D8 of the pillar-map plan keeps `check:pillars` out of the merge
 * gate, because a required step would be red on every push until every pillar is answered. So
 * this exits 0 when both instruments MEASURED, whatever the counts, and 1 when either could not:
 * an exit code other than 0 or 1 (the pillar checker exits 2 on unreadable input), no counts line,
 * or a parity `source-parse` / `ledger-parse` violation (the ledger reports an unreadable source as
 * a violation with exit 1, so the exit code alone cannot tell).
 *
 * Usage: `node scripts/report-program-counts.mjs`
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const INSTRUMENTS = [
  {
    name: 'pillars',
    title: 'Pillar map (`pnpm check:pillars`)',
    script: 'scripts/check-pillar-map.mjs',
    headline: /^\d+ of \d+ pillars (not proven|proven or out)/,
  },
  {
    name: 'parity',
    title: 'TheoClaw parity ledger (`pnpm --filter theoclaw parity`)',
    script: 'apps/theoclaw/tools/check-parity-ledger.mjs',
    headline: /^shipped \d+ · out \d+ · open \d+$/,
  },
]

/**
 * Decide whether one checker run measured anything.
 * @param {'pillars' | 'parity'} name
 * @param {number | null} exitCode
 * @param {string} output stdout and stderr together
 * @returns {{ measured: boolean, headline: string | null, reason: string | null }}
 */
export function judgeRun(name, exitCode, output) {
  const instrument = INSTRUMENTS.find((i) => i.name === name)
  if (instrument === undefined) throw new Error(`unknown instrument: ${name}`)
  const lines = output.split('\n').map((l) => l.trim())
  const headline = lines.find((l) => instrument.headline.test(l)) ?? null
  let reason = null
  if (exitCode !== 0 && exitCode !== 1) reason = `exit code ${String(exitCode)}`
  else if (headline === null) reason = 'no counts line in the output'
  else if (name === 'parity' && lines.some((l) => / (source-parse|ledger-parse):/.test(l))) {
    reason = 'a parity source or the ledger did not parse'
  }
  return { measured: reason === null, headline, reason }
}

/**
 * Run both instruments against `repoRoot` and build the markdown report.
 * @param {string} repoRoot
 * @returns {{ ok: boolean, markdown: string }}
 */
export function runAll(repoRoot) {
  const sections = ['## Program counts', '']
  let ok = true
  for (const instrument of INSTRUMENTS) {
    const run = spawnSync(process.execPath, [resolve(repoRoot, instrument.script)], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120000,
    })
    if (run.error !== undefined) throw run.error
    const output = `${run.stdout}${run.stderr}`
    const verdict = judgeRun(instrument.name, run.status, output)
    ok &&= verdict.measured
    sections.push(
      `### ${instrument.title}`,
      '',
      verdict.measured
        ? `**${String(verdict.headline)}** (exit ${String(run.status)})`
        : `**Not measured:** ${String(verdict.reason)}`,
      '',
      '<details><summary>Full output</summary>',
      '',
      '```',
      output.trimEnd(),
      '```',
      '',
      '</details>',
      '',
    )
  }
  return { ok, markdown: sections.join('\n') }
}

function isDirectRun() {
  try {
    return (
      Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    )
  } catch {
    return false
  }
}

if (isDirectRun()) {
  const { ok, markdown } = runAll(resolve(import.meta.dirname, '..'))
  console.log(markdown)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) appendFileSync(summary, `${markdown}\n`)
  process.exitCode = ok ? 0 : 1
}
