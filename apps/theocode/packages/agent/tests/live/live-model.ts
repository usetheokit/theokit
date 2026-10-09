/**
 * Which model the A2A live test runs: `LIVE_MODEL` trimmed, or the default when it is unset, empty
 * or whitespace (B-407, B-415). The live-model CI job sets one `LIVE_MODEL` for every step, and the
 * framework's preflight and live suite resolve it through `scripts/live-model.mjs`. TheoCode reaches
 * theokit only through published entry points, so the rule is restated here; a root theokit test
 * (`tests/unit/every-live-step-resolves-the-same-model.test.ts`) pins the two equal, case for case.
 */
export const DEFAULT_LIVE_MODEL = 'google/gemini-2.5-flash-lite'

export function resolveLiveModel(env: Record<string, string | undefined>): string {
  const configured = (env.LIVE_MODEL ?? '').trim()
  return configured === '' ? DEFAULT_LIVE_MODEL : configured
}
