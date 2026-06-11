/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time atomic write: caller-controlled paths only. No HTTP input
 * reaches these fs calls.
 */
// T5a.1b — Web Crypto migration. Build-time only; node:fs + node:path stay
// because this is a manifest-write leaf (e.g. .theo/jobs.json) and per
// ADR-0028 the runtime-portable boundary is the request handler, not the
// scanner. Only node:crypto is swapped out — Web Crypto's
// getRandomValues works in every supported runtime.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Write `content` to `path` atomically via the tmp + rename pattern.
 *
 * Two concurrent calls to `writeAtomic(path, ...)` are guaranteed to
 * leave `path` containing valid content from ONE of the calls (never
 * truncated, never interleaved). POSIX rename is atomic on the same
 * filesystem.
 *
 * EC-106 (jobs-crons-webhooks-cost-tracking-plan) — shared helper for
 * `.theo/crons.json` and `.theo/jobs.json` manifest writes so a
 * concurrent dev-server scan + build manifest emit never produces
 * partial JSON.
 *
 * @param path  destination path
 * @param content  bytes (UTF-8 string) to write
 */
export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  // Include a random suffix so two concurrent writes don't trample each
  // other's tmp file. Web Crypto getRandomValues is non-blocking +
  // collision-safe for the tiny entropy we need (8 hex chars = 32 bits).
  // Hex-encoded manually to avoid Buffer (runtime-agnostic per ADR-0028).
  const randBuf = new Uint8Array(4)
  globalThis.crypto.getRandomValues(randBuf)
  let suffix = ''
  for (const b of randBuf) suffix += b.toString(16).padStart(2, '0')
  const tmp = `${path}.tmp-${process.pid}-${suffix}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}
