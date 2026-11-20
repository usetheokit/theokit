/**
 * The one rule for which model the live-model job runs (B-415, CX-3): `LIVE_MODEL` trimmed, or
 * `DEFAULT_LIVE_MODEL` when it is unset, empty or whitespace. The preflight and the
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

/**
 * The model id the SDK routes to OpenRouter. The job's `LIVE_MODEL` is an OpenRouter API id
 * (`google/gemini-2.5-flash-lite`), and the SDK reads a bare `google/` prefix as the Google
 * provider, which refuses the OpenRouter key with HTTP 400. The explicit `openrouter/` prefix
 * routes it. An id that already carries it is kept. The preflight talks to OpenRouter directly, so
 * it keeps `resolveLiveModel`.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function resolveSdkLiveModel(env) {
  const model = resolveLiveModel(env)
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`
}
