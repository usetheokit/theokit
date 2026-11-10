import { redactLog } from '../../../src/ops/logs.js'

/**
 * The reason a `/control` turn failed. The instance writes `theoclaw: turn failed: <reason>` to its
 * stderr but sends the client only `{ type: 'error', code: 'turn_failed' }`, so a live test that
 * throws on that frame adds the instance's output here (#1464). The output is the `theoclaw: turn
 * failed:` lines, or all of it when there are none, passed through the instance's own redaction
 * with the secrets the test holds (model keys, control token, `+code`).
 */
export function turnFailureDetail(output: string, secrets: readonly (string | undefined)[] = []): string {
  const lines = output.split('\n')
  const failed = lines.filter((line) => line.includes('theoclaw: turn failed:'))
  const picked = failed.length > 0 ? failed.join('\n') : output
  return redactLog(
    picked,
    secrets.filter((secret): secret is string => secret !== undefined),
  )
}

/** The error a live test throws for an `error` frame: the frame plus the instance's reason. */
export function turnFailedError(frame: unknown, output: string, secrets: readonly (string | undefined)[] = []): Error {
  return new Error(`the turn failed: ${JSON.stringify(frame)}\ninstance output: ${turnFailureDetail(output, secrets)}`)
}
