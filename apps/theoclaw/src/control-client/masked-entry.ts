import { Security } from '@theokit/sdk'

/** The part of a writable stream the mask wraps: `process.stdout` and `process.stderr` both fit. */
export interface MaskableStream {
  write: NodeJS.WriteStream['write']
}

export interface OutputMask {
  /** Emit, masked, what is held back as a possible start of a credential. */
  flush(): void
  /** Flush, then put the original writers back. */
  uninstall(): void
}

/**
 * Route every write of `streams` through the SDK's exact-value mask (`Security.createMask`) until
 * `uninstall()`, so the adapters' own failure lines carry no credential either. `minLength: 1` keeps
 * a short configured value masked. The SDK has no separate flush: `flush()` unwraps (which releases
 * what is held) and wraps again. A stream already wrapped is refused by the SDK.
 */
export function installOutputMask(secrets: readonly string[], streams: readonly MaskableStream[] = [process.stdout, process.stderr]): OutputMask {
  const mask = Security.createMask(secrets, { minLength: 1 })
  const targets = streams as unknown as readonly NodeJS.WritableStream[]
  let uninstallStreams = mask.wrapStreams(targets)
  let installed = true
  return {
    flush: () => {
      if (!installed) return
      uninstallStreams()
      uninstallStreams = mask.wrapStreams(targets)
    },
    uninstall: () => {
      if (!installed) return
      installed = false
      uninstallStreams()
    },
  }
}

/**
 * Run a surface's `main` with `secrets` masked on its output streams (NFR-002): every write, a
 * `console.error` of a failed turn included, goes through the exact-value mask the instance itself
 * uses. The streams are restored once `main` settles, whether it resolved or threw.
 */
export async function runWithOutputMask<T>(
  secrets: readonly string[],
  main: () => Promise<T>,
  streams: readonly MaskableStream[] = [process.stdout, process.stderr],
): Promise<T> {
  const mask = installOutputMask(secrets, streams)
  try {
    return await main()
  } finally {
    mask.uninstall()
  }
}
