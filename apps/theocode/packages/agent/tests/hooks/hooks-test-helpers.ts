import { tempRoot } from '../helpers/temp-root.js'

/**
 * B-038 — fixtures for the hooks suite, kept because the suite now exists.
 *
 * This file was written for a suite that was never created, so it sat here as dead weight that read
 * as coverage — the B-016 bullet it was closed on. `ctxPre` and `ctxVoid` went with that: nothing
 * exercises the PreToolUse or lifecycle contexts yet, and a fixture for a test nobody wrote is the
 * same defect one file smaller. They come back with the test that needs them.
 */

/** A tool-result turn context, the shape `transform_tool_result` receives. */
export const ctxTurn = (over: Record<string, unknown> = {}): never =>
  ({ agentId: 'a', runId: 'r', toolCalls: [], ...over }) as never

/**
 * A throwaway directory for a hook that writes something observable.
 *
 * CLEANUP IS NOT THE CALLER'S JOB, and this paragraph exists so nobody adds a second one. `tempRoot`
 * records what it made and registers the removal itself, on import — so the hook fires against the
 * test file that imported this module, and `fail-safe-defaults.test.ts` needs no `afterEach` of its
 * own. See `../helpers/temp-root.ts` for why the registration is an import side effect rather than a
 * call a file can forget to make.
 *
 * It used to call `mkdtempSync` here and remove nothing, which left two directories per run behind a
 * seam the calling test could not see: a caller cannot remove what a helper never told it about. The
 * fix belongs with the creation for exactly that reason.
 */
export const tmp = (): string => tempRoot('hooks-')
