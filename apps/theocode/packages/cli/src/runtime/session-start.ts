/**
 * Fire `SessionStart`, once, when a surface mints a session id.
 *
 * The composition both surfaces need: resolve the configuration and the trust posture from the SAME
 * environment (B-033), load the approvals, and hand the specs to the runner. Written once here
 * rather than at each call site so the two surfaces cannot drift on which gate they honour.
 *
 * Why not the framework's `on_session_start`: `hooks/session-start.ts` in `@theocode/agent` carries
 * the measurement. Short version — it fires once per loop context, and this product builds an agent
 * per turn, so the mapping would run the hook on every user message.
 */
import process from 'node:process'

import { resolveEffectiveConfig, resolveTrustPosture } from '@theocode/agent/config'
// This product's `hookFingerprint`, NOT the framework's. Ours wraps it with `identityOf`, which
// converts `timeout_ms` to the `timeoutMs` the framework's identity requires — passing our spec to
// the framework's function directly produces a different hash that no stored approval can match,
// which is exactly how three probes of this came back falsely empty.
import {
  hookFingerprint,
  loadApprovedHooks,
  runSessionStartHooks,
  sessionStartSpecs,
} from '@theocode/agent/hooks'

export async function fireSessionStart(sessionId: string, cwd: string): Promise<void> {
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
    onWarn: (m) => process.stderr.write(`[hooks] ${m}\n`),
  })
}
