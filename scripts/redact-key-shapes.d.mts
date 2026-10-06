/**
 * Types for `redact-key-shapes.mjs`, so the root test imports it without a suppression. The
 * script stays `.mjs` because the CI step pipes into it through plain `node`, with no build.
 */

/**
 * Write every line of `input` to `output` with the configured key and every `sk-or-v1-` key shape
 * replaced by `***`, each line ending in a newline. Resolves when `input` ends.
 */
export function redactStream(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  key: string,
): Promise<void>
