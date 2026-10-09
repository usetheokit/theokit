/**
 * The one rule that keeps a provider key out of the live-model job's log (B-415, NFR-004): any run
 * of 8 or more characters of the configured key, and any `sk-or-v1-` prefix with the hex after it,
 * becomes `***`. Three callers share it: the preflight, the stdin filter the suite step pipes
 * through, and the live suite's `redactThenCut`. It lives in its own module so a change to how the
 * preflight talks to the provider never reaches the code that redacts its answer.
 */
// The prefix at any length, with whatever hex follows it: a head cut a few digits after the prefix
// is still a fragment of some key (B-415, audit L1, review #121).
const KEY_SHAPE = /sk-or-v1-[0-9a-f]*/gi
// The shortest run of the configured key that is redacted on its own. Shorter runs turn up in
// ordinary hex output (a commit SHA, a request id) by chance, and say little about the key.
export const MIN_KEY_FRAGMENT = 8

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
