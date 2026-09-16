/**
 * Fire `SessionStart`, once, when the TUI starts a session.
 *
 * The same composition the CLI does (`cli/src/runtime/session-start.ts`), and the duplication is
 * deliberate rather than a shared helper: the two surfaces resolve their working directory
 * differently — the TUI through its single seam (B-057), the CLI through `process.cwd()` — and a
 * shared function would have to take the directory as an argument, which is the whole content of
 * this file. What is NOT duplicated is the decision about which gates apply: that lives in
 * `sessionStartSpecs` in `@theocode/agent/hooks`, where neither surface can forget it.
 *
 * Never throws and never blocks the frame: a hook failing must not refuse a session the operator
 * just asked for.
 *
 * #57 — that sentence used to be false, and the two call sites in `composition-root.ts` believed
 * it: both fired this with a bare `void`. `runSessionStartHooks` catches per hook into `onWarn`,
 * but the two statements BEFORE it do not — and `resolveEffectiveConfig` throws `ConfigError` on a
 * malformed `settings.json`. Because this function is `async`, that became a rejection with no
 * handler, under `node >=22`, where the default is `--unhandled-rejections=throw`. Reachable after
 * startup: `/new` re-reads the config, so editing the file mid-session and typing `/new` took the
 * terminal down over a typo.
 *
 * The guarantee lives HERE rather than at the call sites, following B-031 in
 * `persistence/session-store.ts`: wrapping the two known voids would leave a third to be found
 * later. There is no longer a way to call this and get it wrong.
 */
import process from 'node:process'

import { resolveEffectiveConfig, resolveTrustPosture } from '@theocode/agent/config'
// This product's `hookFingerprint`, not the framework's — ours converts `timeout_ms` to the
// `timeoutMs` the framework's identity requires, and the store is keyed by ours.
import {
  hookFingerprint,
  loadApprovedHooks,
  runSessionStartHooks,
  sessionStartSpecs,
} from '@theocode/agent/hooks'

import { fireAndForget } from '../persistence/fire-and-forget.js'

/**
 * Under the TUI stderr is a log file nobody has open, so this is the honest limit of the report
 * rather than the ideal one — `/hooks` is where a wired hook is visible.
 */
const toStderr = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

export function fireSessionStart(
  sessionId: string,
  cwd: string,
  report: (message: string) => void = toStderr,
): Promise<void> {
  return fireAndForget(runSessionStart(sessionId, cwd, report), 'the session-start hooks', report)
}

/** The raw run. Private: it rejects, and the whole point of #57 is that the export does not. */
async function runSessionStart(
  sessionId: string,
  cwd: string,
  report: (message: string) => void,
): Promise<void> {
  const posture = resolveTrustPosture(cwd, undefined, process.env)
  const specs = sessionStartSpecs({
    trusted: posture.allows.hooks,
    hooks: resolveEffectiveConfig({ cwd }).hooks,
  })
  if (specs.length === 0) return

  const approved = new Set([...loadApprovedHooks(cwd).keys()])
  await runSessionStartHooks({
    specs,
    cwd,
    sessionId,
    approved: (spec) => approved.has(hookFingerprint(spec)),
    onWarn: (m) => report(`[hooks] ${m}`),
  })
}
