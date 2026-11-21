/**
 * CI hands the live and container checks an OpenRouter API model id (`google/gemini-2.5-flash`)
 * and only an OpenRouter key. The SDK reads a bare `google/` prefix as the Google provider and
 * sends the OpenRouter key to Google, which refuses it. The `openrouter/` prefix routes it. Local
 * runs keep the model the developer chose, since their key may be a direct provider's.
 */
export function normalizeCiLiveModel(env: Record<string, string | undefined>): void {
  const live = env.THEOCLAW_LIVE === '1' || env.THEOCLAW_CONTAINER === '1'
  if (env.GITHUB_ACTIONS !== 'true' || !live) return
  const model = (env.THEOCLAW_MODEL ?? '').trim()
  if (model === '' || model.startsWith('openrouter/')) return
  env.THEOCLAW_MODEL = `openrouter/${model}`
}

normalizeCiLiveModel(process.env)
