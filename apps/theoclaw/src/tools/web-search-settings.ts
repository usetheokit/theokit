import { resolveWebSearchAdapter } from '@theokit/sdk-tools'
import type { WebSearchCallback, WebSearchProvider } from '@theokit/sdk-tools'

import { TheoClawConfigError } from '../control-plane/errors.js'

type Env = Readonly<Record<string, string | undefined>>

/** Where web search goes, chosen from the keys present at start. */
export interface SearchSettings {
  readonly kind: WebSearchProvider | 'off'
  readonly adapter?: WebSearchCallback
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Web search over the SDK's `resolveWebSearchAdapter`, fed only the variables TheoClaw honours.
 * `THEOCLAW_SEARCH=searxng:<url>` or `tavily` (key in `TAVILY_API_KEY`) wins; else Brave when
 * `BRAVE_API_KEY` is set, else the generic adapter when `THEOKIT_SEARCH_API_URL` and
 * `THEOKIT_SEARCH_API_KEY` both are. A Tavily key alone never turns search on here. A blank value
 * counts as unset.
 */
export function resolveSearch(env: Env, fetchImpl: typeof fetch): SearchSettings {
  const chosen = nonBlank(env.THEOCLAW_SEARCH)
  if (chosen !== undefined && chosen !== 'tavily' && !chosen.startsWith('searxng:')) {
    throw new TheoClawConfigError(`THEOCLAW_SEARCH must be searxng:<url> or tavily, got ${JSON.stringify(chosen)}`, { variable: 'THEOCLAW_SEARCH' })
  }
  const input: Record<string, string | undefined> = {
    BRAVE_API_KEY: env.BRAVE_API_KEY,
    THEOKIT_SEARCH_API_URL: env.THEOKIT_SEARCH_API_URL,
    THEOKIT_SEARCH_API_KEY: env.THEOKIT_SEARCH_API_KEY,
    ...(chosen === undefined ? {} : { THEOKIT_SEARCH: chosen, TAVILY_API_KEY: env.TAVILY_API_KEY }),
  }
  try {
    const { adapter, provider } = resolveWebSearchAdapter(input, { fetchImpl })
    return adapter === undefined || provider === undefined ? { kind: 'off' } : { kind: provider, adapter }
  } catch (error) {
    throw searchConfigError(error, env, chosen)
  }
}

/**
 * The SDK's `ConfigurationError` as a `TheoClawConfigError` naming the variable to fix. The SDK
 * sets only a `code`, so the variable is worked out from the environment, not from its message;
 * an error of any other code passes through unchanged.
 */
function searchConfigError(error: unknown, env: Env, chosen: string | undefined): unknown {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'web_search_invalid_url') {
    return new TheoClawConfigError('THEOCLAW_SEARCH=searxng:<url> needs an http(s) URL, e.g. searxng:http://localhost:8888', { variable: 'THEOCLAW_SEARCH' })
  }
  if (code !== 'web_search_missing_variable') return error
  if (chosen === 'tavily') return new TheoClawConfigError('THEOCLAW_SEARCH=tavily needs TAVILY_API_KEY', { variable: 'TAVILY_API_KEY' })
  const missing = nonBlank(env.THEOKIT_SEARCH_API_URL) === undefined ? 'THEOKIT_SEARCH_API_URL' : 'THEOKIT_SEARCH_API_KEY'
  const present = missing === 'THEOKIT_SEARCH_API_URL' ? 'THEOKIT_SEARCH_API_KEY' : 'THEOKIT_SEARCH_API_URL'
  return new TheoClawConfigError(`${present} is set without ${missing}; set both or neither`, { variable: missing })
}
