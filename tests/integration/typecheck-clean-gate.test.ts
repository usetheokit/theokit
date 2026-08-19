import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const REPO = resolve(__dirname, '../..')

/**
 * `pnpm typecheck` is `pnpm --filter "./packages/*" build && tsc --noEmit`. Two tests here need its
 * output, and each used to invoke it inside its own 120s budget.
 *
 * The budget was the problem, not the duplication. Measured isolated, the whole file took 86s and
 * 96.67s in two sessions on different machines — 12% apart, and 80% of a 120s budget in the best
 * condition available; the full-suite run timed out (theokit#338). A budget that close to the cost
 * does not need adverse load to fail, and the cost grows with the package count, so the margin was
 * shrinking on its own.
 *
 * Honest note on what hoisting the call did NOT buy: the second invocation was mostly a build-cache
 * hit, so the file after this change measures 97.19s — the same range as before. What it buys is one
 * budget instead of two, sized on the measurement: 300s is ~3x the measured worst case, headroom for
 * the monorepo to grow into rather than a number someone guessed. The duplicate subprocess going
 * away is tidiness, not the fix.
 */
let typecheckOutput = ''

describe('pnpm typecheck clean gate (T0.3)', () => {
  beforeAll(() => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer-local gate invoking pnpm CLI
    typecheckOutput = execSync('pnpm typecheck 2>&1 || true', {
      cwd: REPO,
      encoding: 'utf8',
    })
  }, 300_000)

  it('pnpm typecheck exits 0 (zero TS errors across workspace)', () => {
    const errorCount = (typecheckOutput.match(/error TS/g) ?? []).length
    expect(errorCount).toBe(0)
  })

  // EC-203: pre-flight isolation of SDK-rooted errors (kept as audit
  // even though count is currently 0 — the gate is "no NEW SDK errors").
  it('EC-203: pre-flight audit doc records SDK-rooted error count', () => {
    // Generated artifact, not authored knowledge: this file is rewritten on every
    // run, so it lives under `.audit/` (gitignored) rather than in the tracked tree.
    const auditDir = resolve(REPO, '.audit/typecheck')
    if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true })

    const result = typecheckOutput
    const sdkRooted = (
      result.match(
        /examples\/full-stack-agent\/server\/tools.*@theokit\/sdk|toJSONSchema|ZodObject/g,
      ) ?? []
    ).length

    const date = new Date().toISOString().slice(0, 10)
    const auditPath = resolve(auditDir, `phase-0-typecheck-pre-flight-${date}.md`)
    writeFileSync(
      auditPath,
      `# Phase 0 Typecheck Pre-Flight Audit\n\nDate: ${date}\nSDK-rooted error count: ${sdkRooted}\nTotal TS errors: ${(result.match(/error TS/g) ?? []).length}\n\nGate: SDK-rooted errors are documented separately per EC-203; non-SDK errors must be 0.\n`,
      'utf8',
    )
    expect(existsSync(auditPath)).toBe(true)
  })

  it('no actual @ts-ignore directives introduced (EC-205 sibling check)', () => {
    // Match ONLY actual directive uses (`// @ts-ignore` comment), NOT
    // string mentions in audit code or test assertions.
    const result = execSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer-local gate running grep
      'grep -rEn "^[[:space:]]*//[[:space:]]*@ts-ignore" packages/theo/src tests/ 2>&1 || true',
      { cwd: REPO, encoding: 'utf8' },
    )
    const directiveCount = (result.match(/^[^:]+:\d+:/gm) ?? []).length
    expect(directiveCount).toBe(0)
  }, 30_000)

  // EC-205: orphan @ts-expect-error directives become lint errors after
  // Zod fix removes the underlying TS errors. Lint reports them as
  // "Unused @ts-expect-error directive". Gate is via lint, not typecheck.
  it('@ts-expect-error count in tests is bounded (no explosion post-Zod-fix)', () => {
    const result = execSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer-local gate running grep
      'grep -rn "@ts-expect-error" tests/ 2>&1 || true',
      { cwd: REPO, encoding: 'utf8' },
    )
    const count = (result.match(/^[^:]+:\d+:/gm) ?? []).length
    // Empirical baseline: legitimate uses are < 50 across tests/.
    // If post-fix count balloons, we have new orphans.
    expect(count).toBeLessThan(50)
  })
})
