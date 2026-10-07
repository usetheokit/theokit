/**
 * One request to OpenRouter before the live suite runs, printed as one named line: the model's
 * answer, or why the job could not run (B-415, OBJ-9). A provider outage or a missing secret must
 * read as a red run with a reason, never as a pass.
 *
 *   node scripts/live-model-preflight.mjs        (reads OPENROUTER_API_KEY and LIVE_MODEL)
 *
 * Every printed line goes through `redact` on its full text first, so neither the configured key,
 * nor any run of 8 or more of its characters, nor any `sk-or-v1-` prefix reaches the log, even cut
 * in half by a truncation that ran before or after it.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PREFLIGHT_TIMEOUT_MS = 30_000
export const MAX_OUTPUT_TOKENS = 16
export const DEFAULT_LIVE_MODEL = 'google/gemini-2.5-flash-lite'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const KEY_ABSENT = 'provider key absent: the live-model job could not run'
// The prefix at any length, with whatever hex follows it: a head cut a few digits after the prefix
// is still a fragment of some key (B-415, audit L1, review #121).
const KEY_SHAPE = /sk-or-v1-[0-9a-f]*/gi
// The shortest run of the configured key that is redacted on its own. Shorter runs turn up in
// ordinary hex output (a commit SHA, a request id) by chance, and say little about the key.
export const MIN_KEY_FRAGMENT = 8
const RESPONSE_LIMIT = 200

/**
 * The `[start, end)` spans of every run of `MIN_KEY_FRAGMENT` or more characters of `key`, scanning
 * left to right and taking the longest run at each position, so a head, a tail or a middle of the
 * key cut by a truncation is found as well as the whole key. A key shorter than the minimum is
 * found only whole.
 * @param {string} text
 * @param {string} key
 * @returns {Array<[number, number]>}
 */
function keyRunSpans(text, key) {
  const spans = []
  if (key === '') return spans
  if (key.length < MIN_KEY_FRAGMENT) {
    for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + key.length)) {
      spans.push([at, at + key.length])
    }
    return spans
  }
  let i = 0
  while (i < text.length) {
    let run = 0
    if (i + MIN_KEY_FRAGMENT <= text.length && key.includes(text.slice(i, i + MIN_KEY_FRAGMENT))) {
      run = MIN_KEY_FRAGMENT
      while (i + run < text.length && key.includes(text.slice(i, i + run + 1))) run += 1
    }
    if (run > 0) {
      spans.push([i, i + run])
      i += run
    } else {
      i += 1
    }
  }
  return spans
}

/**
 * Replace every run of 8 or more characters of the configured key, and every `sk-or-v1-` prefix
 * with the hex that follows it, with `***`. Both are found on the original text and their spans
 * merged, so neither pass can hide text from the other: redacting the configured key's own prefix
 * as a run first used to leave another key's prefix unmatched and its hex in the log (B-415,
 * F-9fe94e30). Overlapping or adjacent spans become one `***`.
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
export function redact(text, key) {
  const shapeSpans = [...text.matchAll(KEY_SHAPE)].map((m) => [m.index, m.index + m[0].length])
  const merged = []
  for (const [start, end] of [...keyRunSpans(text, key), ...shapeSpans].sort(
    (x, y) => x[0] - y[0],
  )) {
    const last = merged.at(-1)
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  let out = ''
  let cursor = 0
  for (const [start, end] of merged) {
    out += `${text.slice(cursor, start)}***`
    cursor = end
  }
  return out + text.slice(cursor)
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
