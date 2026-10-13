/**
 * A stdin-to-stdout filter the live-model job pipes the live suite's whole output through, so no
 * fragment of the configured key reaches the CI log (B-415, NFR-004). Provider text cut at a fixed
 * length can leave part of a key behind where GitHub's exact-value masking does not see it; this
 * filter redacts every line with `redact` (`redact-provider-keys.mjs`) before it is written: any
 * run of 8 or more characters of `OPENROUTER_API_KEY`, and any `sk-or-v1-` prefix with the hex
 * after it. Runs of 7 or fewer characters are not redacted, and neither is a fragment of a key
 * nobody configured unless it still carries the prefix. The live suites also redact before they
 * truncate.
 *
 *   pnpm --filter @theokit/agents test:live 2>&1 | node scripts/redact-key-shapes.mjs
 *
 * The step runs under `bash -eo pipefail`, so the suite's exit code survives the pipe, and a crash
 * of this filter fails the step.
 */
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { redact } from './redact-provider-keys.mjs'

/**
 * Write every line of `input` to `output`, redacted, each ending in a newline. Line-based, so a
 * key the producer wrote across two chunks is redacted whole.
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @param {string} key the configured key; blank applies the prefix pattern only
 * @returns {Promise<void>}
 */
export async function redactStream(input, output, key) {
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    output.write(`${redact(line, key)}\n`)
  }
}

// Only when run as a script: importing this module reads no stdin.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await redactStream(process.stdin, process.stdout, (process.env.OPENROUTER_API_KEY ?? '').trim())
}
