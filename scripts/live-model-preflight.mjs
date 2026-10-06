/**
 * One request to OpenRouter before the live suite runs, printed as one named line: the model's
 * answer, or why the job could not run (B-415, OBJ-9). A provider outage or a missing secret must
 * read as a red run with a reason, never as a pass.
 *
 *   node scripts/live-model-preflight.mjs        (reads OPENROUTER_API_KEY and LIVE_MODEL)
 *
 * Every printed line goes through `redact` on its full text first, so neither the configured key
 * nor any other `sk-or-v1-` key shape reaches the log, even cut in half by a later truncation.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PREFLIGHT_TIMEOUT_MS = 30_000
export const MAX_OUTPUT_TOKENS = 16
export const DEFAULT_LIVE_MODEL = 'google/gemini-2.5-flash-lite'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const KEY_ABSENT = 'provider key absent: the live-model job could not run'
const KEY_SHAPE = /sk-or-v1-[0-9a-f]{16,}/gi
const RESPONSE_LIMIT = 200

/**
 * Replace the configured key, then every `sk-or-v1-` key shape, with `***`.
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
export function redact(text, key) {
  const withoutKey = key === '' ? text : text.split(key).join('***')
  return withoutKey.replace(KEY_SHAPE, '***')
}

/** @param {string} text already redacted */
function oneLine(text) {
  return text.replace(/\r?\n/g, ' ').slice(0, RESPONSE_LIMIT)
}

/** @param {Record<string, string | undefined>} env */
function liveModel(env) {
  const configured = (env.LIVE_MODEL ?? '').trim()
  return configured === '' ? DEFAULT_LIVE_MODEL : configured
}

/**
 * @param {Response} res
 * @returns {Promise<string>} the answer's non-blank content, or '' when it carries none
 */
async function contentOf(res) {
  try {
    const body = /** @type {{ choices?: { message?: { content?: unknown } }[] }} */ (
      await res.json()
    )
    const content = body.choices?.[0]?.message?.content
    return typeof content === 'string' ? content.trim() : ''
  } catch (error) {
    // A body that is not JSON carries no content, which the caller names. Anything else, such as
    // the timeout firing while the body is read, propagates and is named as unreachable.
    if (error instanceof SyntaxError) return ''
    throw error
  }
}

/**
 * @param {Response} res
 * @param {(line: string) => void} say
 * @returns {Promise<0 | 1>}
 */
async function classify(res, say) {
  const code = res.status
  if (code === 401 || code === 403) {
    say(`provider rejected the credential (HTTP ${String(code)})`)
    return 1
  }
  if (code === 402 || code === 429 || (code >= 500 && code <= 599)) {
    say(`provider could not be reached: HTTP ${String(code)}`)
    return 1
  }
  if (!res.ok) {
    say(`provider refused the request (HTTP ${String(code)})`)
    return 1
  }
  const content = await contentOf(res)
  if (content === '') {
    say(`provider could not be reached: answer carried no content (HTTP ${String(code)})`)
    return 1
  }
  say(`[live] model response: ${content}`)
  return 0
}

/**
 * @param {{
 *   env: Record<string, string | undefined>,
 *   fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
 *   log: (line: string) => void,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<0 | 1>}
 */
export async function runPreflight({ env, fetchImpl, log, timeoutMs = PREFLIGHT_TIMEOUT_MS }) {
  const key = (env.OPENROUTER_API_KEY ?? '').trim()
  if (key === '') {
    log(KEY_ABSENT)
    return 1
  }
  /** @param {string} line */
  const say = (line) => log(oneLine(redact(line, key)))
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: liveModel(env),
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return await classify(res, say)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    say(`provider could not be reached: ${err.name}: ${err.message}`)
    return 1
  }
}

// Only when run as a script: importing this module (the test, the redactor) sends no request.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPreflight({ env: process.env, fetchImpl: fetch, log: console.log })
}
