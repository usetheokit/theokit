/**
 * `theokit preview` — build for production, then serve the result.
 *
 * Reproducing production locally was two commands, `theokit build` then
 * `theokit start`, and the two-step version fails silently: `start` serves
 * whatever `.theokit/` already holds, so a skipped build serves the previous one
 * and nothing says so. The gap is widest exactly when it matters — after a
 * change, checking whether the change works (B-030).
 *
 * This is not a third implementation of either step. It calls both, in order,
 * and never reaches the second when the first throws. `build` and `start` stay
 * separately invocable because CI builds and serves in different jobs.
 */

export interface PreviewOptions {
  /** Port for the production server. Forwarded to `start`. */
  port?: number
  /** Deploy target to build for. Forwarded to `build`. */
  target?: string
}

/**
 * The two steps, injected so the composition can be tested without running a
 * real build — the composition IS the behaviour here, and a test that shells out
 * to a full build would be testing the build.
 */
export interface PreviewSteps {
  build: (opts: { target?: string }) => Promise<void>
  start: (opts: { port?: number }) => Promise<void>
}

async function defaultSteps(): Promise<PreviewSteps> {
  const [{ buildCommand }, { startCommand }] = await Promise.all([
    import('./build.js'),
    import('./start/index.js'),
  ])
  return {
    build: (opts) => buildCommand(opts),
    start: (opts) => startCommand(opts),
  }
}

export async function previewCommand(
  options: PreviewOptions = {},
  steps?: PreviewSteps,
): Promise<void> {
  const { build, start } = steps ?? (await defaultSteps())

  // No catch: a build failure must reach the caller unchanged. Swallowing it
  // here and starting anyway would serve the previous build — the exact defect
  // this command exists to remove, reproduced inside its own fix.
  await build({ target: options.target })
  await start({ port: options.port })
}
