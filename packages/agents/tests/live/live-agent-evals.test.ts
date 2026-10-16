/**
 * B-413 LIVE proof — `runAgentEvals` runs a theokit agent definition against a REAL provider and
 * reports a verdict per case. Run with a provider key in the environment:
 *
 *   THEOKIT_LIVE_REQUIRED=1 node --env-file=<path>/.env node_modules/vitest/vitest.mjs run \
 *     --config vitest.live.config.ts tests/live/live-agent-evals.test.ts
 *
 * Why live: every deterministic suite mocks `@theokit/sdk`, so only a real run proves that each case
 * goes through the definition (system prompt included) to a model, that the SDK's scorer reads the
 * real output, and that the verdict this layer computes matches what the model said. One case is
 * built to pass and one to fail, so a run that scored everything the same way cannot go green.
 *
 * Prints which key variable is present (never its value), the model id, and each case's input,
 * redacted output, mean score and verdict.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { Scorers, runAgentEvals } from '../../src/evals-entry.js'

import { resolveLiveModel } from '../../../../scripts/live-model.mjs'

import { redactThenCut } from './provider-text.js'
import { LIVE_KEY_NAMES } from './require-provider-key.js'

const MODEL = resolveLiveModel(process.env)
const PRESENT_KEYS = LIVE_KEY_NAMES.filter((n) => (process.env[n]?.trim() ?? '') !== '')
const HAS_KEY = PRESENT_KEYS.length > 0

function apiKey(): string {
  for (const n of LIVE_KEY_NAMES) {
    const v = process.env[n]?.trim()
    if (v !== undefined && v !== '') return v
  }
  throw new Error(`no provider key present: none of ${LIVE_KEY_NAMES.join(', ')} is set`)
}

const workDirs: string[] = []

afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!HAS_KEY)('LIVE — runAgentEvals against a real provider', () => {
  it('reports one pass and one fail for a case built to pass and a case built to fail', async () => {
    console.log(`[live] provider key present: ${PRESENT_KEYS.join(', ')}`)
    console.log(`[live] model: ${MODEL}`)

    const cwd = mkdtempSync(join(tmpdir(), 'live-agent-evals-'))
    workDirs.push(cwd)

    const agent = AgentBuilder.create()
      .model(MODEL)
      // KIWI rather than the plan's PAPAYA: one run in ten of a PAPAYA instruction answered with the
      // Portuguese spelling "PAPAIA", which the scorer rightly marked fail and this test then read
      // as a broken verdict. KIWI is spelled the same in every language the model drifted toward.
      .system('Whatever you are asked, reply with exactly one word: KIWI.')
      .build()

    const result = await runAgentEvals({
      agent,
      apiKey: apiKey(),
      // The agent declares no tools, so no approval request can arise; refusing is the safe reading.
      approvals: { kind: 'auto-reject', reason: 'live eval proof: the agent has no tools' },
      cases: [
        { input: 'What is your word?', expected: 'KIWI' },
        { input: 'What is your word?', expected: 'ZEPPELIN' },
      ],
      scorers: [Scorers.containsExpected()],
      overrides: { cwd },
    })

    for (const c of result.cases) {
      console.log(
        `[live] case ${c.index}: input=${JSON.stringify(c.input)} ` +
          `output=${JSON.stringify(redactThenCut(c.output, 200))} ` +
          `meanScore=${c.meanScore} verdict=${c.verdict}` +
          (c.error === undefined ? '' : ` error=${redactThenCut(c.error, 200)}`),
      )
    }
    console.log(`[live] counts: ${JSON.stringify(result.counts)}`)

    expect(result.cases.every((c) => c.error === undefined)).toBe(true)
    expect(result.cases.every((c) => c.output.length > 0)).toBe(true)
    expect(result.cases.map((c) => c.verdict)).toEqual(['pass', 'fail'])
    expect(result.counts).toEqual({ pass: 1, fail: 1, error: 0 })
  }, 120_000)
})
