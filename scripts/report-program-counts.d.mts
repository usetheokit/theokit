/**
 * Types for `report-program-counts.mjs`, so the root test imports it without a suppression. The
 * script stays `.mjs` because `program-counts.yml` runs it through plain `node`, with no install.
 */

/** Whether one checker run measured anything, its counts line, and why not when it did not. */
export function judgeRun(
  name: 'pillars' | 'parity',
  exitCode: number | null,
  output: string,
): { measured: boolean; headline: string | null; reason: string | null }

/** Run both instruments against `repoRoot` and build the markdown report. */
export function runAll(repoRoot: string): { ok: boolean; markdown: string }
