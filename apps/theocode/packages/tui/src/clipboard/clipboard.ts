/**
 * B-075 — putting text on the system clipboard, or saying clearly that there is none.
 *
 * No dependency is added (parsimony ladder rung 3): every desktop already ships a clipboard binary,
 * and Node has no clipboard API to reuse. Candidates are tried in order; the first that exists wins.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

import { CLIPBOARD_COMMANDS, type ClipboardCommand } from './clipboard-commands.js'
import { NoClipboardError } from './clipboard-errors.js'
import { ClipboardWriteError } from './clipboard-write-error.js'

type Runner = (bin: string, args: readonly string[], input: string) => SpawnSyncReturns<string>

/**
 * B-145 — the bound on a clipboard binary that is installed but not answering.
 *
 * `wl-copy`, `xclip` and `xsel` are exactly the programs that hang when `DISPLAY`/`WAYLAND_DISPLAY`
 * is set and the compositor is not responding. `spawnSync` does not merely take time, it blocks the
 * event loop — which here is the Ink render loop, so a frozen frame with no cursor is what the user
 * sees, indistinguishable from a crash.
 *
 * Five seconds: copying text is instant on a working desktop, and a bound much tighter would start
 * failing a slow-but-working clipboard. `spawnSync` reports the kill through `result.error`, which
 * the loop below already turns into a `ClipboardWriteError` — so a timeout surfaces as a real
 * failure of an installed clipboard rather than as a silent success.
 */
export const CLIPBOARD_TIMEOUT_MS = 5_000

/**
 * The options `spawnSync` is actually called with, as a value a test can read.
 *
 * A constant that exists and never reaches the call is the same as no bound — and this release has
 * now shipped that exact defect twice (the collector's `apply: true`, and this). Exporting the
 * object is what lets a test assert the bound is PASSED rather than merely declared.
 */
export function clipboardSpawnOptions(input: string): {
  input: string
  encoding: 'utf8'
  timeout: number
} {
  return { input, encoding: 'utf8', timeout: CLIPBOARD_TIMEOUT_MS }
}

const defaultRunner: Runner = (bin, args, input) =>
  spawnSync(bin, [...args], clipboardSpawnOptions(input))

/**
 * Copy `text` to the system clipboard.
 *
 * @throws NoClipboardError when no candidate binary exists.
 * @throws ClipboardWriteError when one exists and refuses the text.
 */
export function copyToClipboard(
  text: string,
  opts: { runner?: Runner; candidates?: readonly ClipboardCommand[] } = {},
): { bin: string } {
  const run = opts.runner ?? defaultRunner
  for (const { bin, args } of opts.candidates ?? CLIPBOARD_COMMANDS) {
    const result = run(bin, args, text)
    // ENOENT means this binary is absent — try the next. Any OTHER error is a real failure of a
    // clipboard that IS installed, and swallowing it would be the silent no-op this guards against.
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') continue
    if (result.error !== undefined) throw new ClipboardWriteError(bin, result.error.message)
    if (result.status !== 0) {
      throw new ClipboardWriteError(bin, `exited ${String(result.status)}: ${result.stderr ?? ''}`)
    }
    return { bin }
  }
  throw new NoClipboardError()
}
