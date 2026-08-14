import { appendFileSync } from 'node:fs'

import { setDiagnosticsSink } from '@theokit/sdk'

/**
 * M84 — route the SDK's diagnostics somewhere, from an env var.
 *
 * `setDiagnosticsSink` already crossed as a pass-through. A seam whose ONLY use is "send this to
 * stderr, or to a file when debugging" should ship with that use — otherwise every product writes
 * the same thirty lines, and each one picks a different env var name, so the instruction in a bug
 * report ("set THEOKIT_DEBUG and re-run") is wrong for half the products built on the framework.
 */

/** Where diagnostics went, so a caller can say so. */
export type DiagnosticDestination =
  | { readonly kind: 'off' }
  | { readonly kind: 'stderr' }
  | { readonly kind: 'file'; readonly path: string }

export interface InstallDiagnosticSinkOptions {
  /** The environment to read. Injected so a test never depends on the ambient one. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Where a write failure is reported. */
  readonly onWarn?: (message: string) => void
  /**
   * How the sink is installed. Defaults to the SDK's `setDiagnosticsSink`.
   *
   * Injected so a test can DRIVE the installed sink rather than assert that installation returned
   * a shape. The first version of the test asserted that no warning had fired — which was true only
   * because nothing had ever called the sink, and would have passed against a sink that swallowed
   * every failure.
   */
  readonly install?: (sink: (message: string) => void) => void
}

/** `1`/`true`/`stderr` ⇒ stderr; any other non-empty value ⇒ a file path; absent ⇒ off. */
const STDERR_VALUES = new Set(['1', 'true', 'stderr', 'yes'])

/**
 * Install the diagnostics sink from `THEOKIT_DIAGNOSTICS`.
 *
 * Returns where it went, rather than logging it: a function that announces itself on stdout would
 * corrupt the output of any command whose result is piped.
 */
export function installDiagnosticSink(
  options: InstallDiagnosticSinkOptions = {},
): DiagnosticDestination {
  const env = options.env ?? process.env
  const install = options.install ?? setDiagnosticsSink
  const raw = env.THEOKIT_DIAGNOSTICS
  if (raw === undefined || raw === '') return { kind: 'off' }

  if (STDERR_VALUES.has(raw.toLowerCase())) {
    // stderr and NOT stdout: a diagnostic interleaved with an agent's answer corrupts the answer for
    // anything reading it — which is every script that pipes `theokit agent`.
    install((message: string) => {
      process.stderr.write(`${message}\n`)
    })
    return { kind: 'stderr' }
  }

  const path = raw
  install((message: string) => {
    try {
      // The variable path IS the feature: it comes from the operator's own environment, not from
      // request input. No HTTP surface reaches here.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
      appendFileSync(path, `${message}\n`, 'utf8')
    } catch (error) {
      // A diagnostics sink that throws takes down the run it was installed to observe — the failure
      // mode where turning on debugging is what breaks the thing you were debugging.
      options.onWarn?.(`diagnostics could not be written to ${path}: ${(error as Error).message}`)
    }
  })
  return { kind: 'file', path }
}
