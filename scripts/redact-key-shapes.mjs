/**
 * A stdin-to-stdout filter the live-model job pipes the live suite's whole output through, so no
 * key-shaped string reaches the CI log (B-415, NFR-004). The live suite prints provider text cut
 * at a fixed length, which can leave half a key behind where GitHub's exact-value masking does not
 * see it; this filter redacts every line with the preflight's `redact` before it is written.
 *
 *   pnpm --filter @theokit/agents test:live 2>&1 | node scripts/redact-key-shapes.mjs
 *
 * The step runs under `bash -eo pipefail`, so the suite's exit code survives the pipe, and a crash
 * of this filter fails the step.
 */
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { redact } from './live-model-preflight.mjs'

/**
 * Write every line of `input` to `output`, redacted, each ending in a newline. Line-based, so a
 * key the producer wrote across two chunks is redacted whole.
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @param {string} key the configured key; blank applies the key-shape pattern only
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
