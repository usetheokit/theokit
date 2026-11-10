import { configuredSecrets, redactLog } from '../../../src/ops/logs.js'

const MARKER = 'theoclaw: turn failed:'

/**
 * The error a live test throws on an `error` frame. The frame carries only a code; the reason is
 * in the instance's stderr as `theoclaw: turn failed: <reason>` (#1464). Those lines, or the whole
 * output when there are none, go through the redaction the instance uses, so no key, control token
 * or `+code` reaches the error. `secrets` adds values the test knows (its control token).
 */
export function turnFailedError(
  frame: unknown,
  output: string,
  secrets: readonly string[] = [],
): Error {
  const lines = output.split('\n').filter((line) => line.includes(MARKER))
  const evidence = lines.length > 0 ? lines.join('\n') : output
  const text = redactLog(`turn failed: ${JSON.stringify(frame)}\ninstance output:\n${evidence}`, [
    ...configuredSecrets(process.env),
    ...secrets,
  ])
  return new Error(text)
}
