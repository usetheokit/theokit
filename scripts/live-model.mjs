/**
 * The one rule for which model the live-model job runs (B-415, CX-3): `LIVE_MODEL` trimmed, or
 * `DEFAULT_LIVE_MODEL` when it is unset, empty or whitespace. The preflight and the three
 * `@theokit/agents` live files read it from here, so the job's single `LIVE_MODEL` is one model in
 * every step. TheoCode restates it beside its own live test, and a root test pins the two equal.
 */

export const DEFAULT_LIVE_MODEL = 'google/gemini-2.5-flash-lite'

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function resolveLiveModel(env) {
  const configured = (env.LIVE_MODEL ?? '').trim()
  return configured === '' ? DEFAULT_LIVE_MODEL : configured
}
