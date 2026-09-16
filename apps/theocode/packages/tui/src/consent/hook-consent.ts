import type { classifyHooks, parseHooks } from '@theocode/agent/hooks'

type ParseHooks = typeof parseHooks
type ClassifyHooks = typeof classifyHooks
type ClassifiedHook = ReturnType<ClassifyHooks>[number]

export interface HookConsentDeps {
  cwd: string
  declined: ReadonlySet<string>
  resolveEffectiveConfig: (opts: { cwd: string }) => { hooks?: unknown }
  parseHooks: ParseHooks
  classifyHooks: ClassifyHooks
  onError: (err: unknown) => void
}

export function computePendingHooks(deps: HookConsentDeps): ClassifiedHook[] {
  try {
    const specs = deps.parseHooks(deps.resolveEffectiveConfig({ cwd: deps.cwd }).hooks)
    return (
      deps
        // `previousByEvent` is gone: it was a heuristic (exactly one orphaned approval plus exactly
        // one new hook in the same event meant "edited"), and the framework store decides `modified`
        // by comparing the event+matcher SLOT — no counting, and no ambiguity when two hooks change at
        // once. What it needs instead is WHICH project is being asked about.
        //
        // The approval store is NOT read here, and that is the point of finding #61: this used to
        // call `loadApprovedHooks(deps.cwd)` and pass the result, so the code read as though the
        // classification were decided by that read. It never was — `classifyHooks` reads the store
        // itself, deliberately, so a stale copy cannot answer a security question. The read is gone
        // rather than kept as decoration, and with it a failure mode: it could throw, and the catch
        // below turns any throw into "nothing pending", which closes the gate.
        .classifyHooks(specs, { dir: deps.cwd })
        .filter((h) => h.status !== 'trusted' && !deps.declined.has(h.fingerprint))
    )
  } catch (err) {
    // B-039 — a HookError used to be discarded here, with no diagnostic at all. An empty list means
    // "nothing pending", so the gate closes and the user is never asked: their config is broken, no
    // hook will ever run, and the terminal says nothing. Fail-open on the surface that governs
    // `spawn(cmd, { shell: true })`.
    //
    // The name check stays, because a config mistake is not an internal error and should not read
    // as one. What was missing was the reporting, not the classification.
    deps.onError(
      (err as Error)?.name === 'HookError'
        ? new Error(
            `hooks are DISABLED: the \`hooks\` block in your config could not be read — ` +
              `${(err as Error).message}`,
          )
        : err,
    )
    return []
  }
}
