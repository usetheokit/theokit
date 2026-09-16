import { homedir } from 'node:os'

import { Agent } from '@theokit/agents'

import { resolveCredentialForModel } from '@theocode/agent/auth'
import { resolveEffectiveConfig } from '@theocode/agent/config'
import { createShutdown, DEFAULT_WATCHDOG_MS } from '@theokit/agents/commands'
import type { Shutdown } from '@theokit/agents/commands'
import { createReviewAgent } from '@theocode/agent/review'
import { runReview } from '@theocode/agent/review'
import type { ToastPayload } from '../screen-types.js'
import { workingDirectory } from '../working-directory.js'
import { createGitRunner } from '@theocode/shared/git-runner'

export interface ReviewCommandDeps {
  setReviewResult: (r: string | null) => void
  setToast: (t: ToastPayload | null) => void
}

/**
 * Build the review's shutdown, and hand back the way to UNINSTALL its signal handlers.
 *
 * The local `shared/shutdown.ts` was deleted for the framework's, whose signal handling is a
 * constructor dependency (`onSignal`) rather than a separate `installSignalHandler` call. The two
 * steps therefore became one — and the disposer, which the previous shape returned, is captured
 * here instead.
 *
 * The disposer is not incidental. This shutdown belongs to a TRANSIENT command: leaving its
 * handlers on `process` after the review closes means the next Ctrl-C runs a teardown for a review
 * that is no longer open. Registering with `process.once` and removing on exit is what keeps a
 * short-lived command from mutating the process for the rest of the session.
 */
function reviewShutdown(setToast: ReviewCommandDeps['setToast']): {
  shutdown: Shutdown
  uninstallSignals: () => void
} {
  const installed: Array<[NodeJS.Signals, () => void]> = []

  const shutdown = createShutdown({
    watchdogMs: DEFAULT_WATCHDOG_MS,
    onSignal: (sig, fn) => {
      process.once(sig, fn)
      installed.push([sig, fn])
    },
    exit: (code) => {
      process.exit(code)
    },
    onWarn: (message) => {
      setToast({ message: `discarding the review failed: ${message}`, variant: 'error' })
    },
  })

  return {
    shutdown,
    uninstallSignals: () => {
      for (const [sig, fn] of installed) process.off(sig, fn)
    },
  }
}

async function hookChain(hooks: ReturnType<typeof resolveEffectiveConfig>['hooks']) {
  const { parseHooks, buildHookHandlers, loadApprovedHooks } = await import('@theocode/agent/hooks')
  const { resolveTrustPosture } = await import('@theocode/agent/config')
  return buildHookHandlers(parseHooks(hooks), {
    trusted: resolveTrustPosture(workingDirectory()).allows.hooks,
    approved: new Set([...loadApprovedHooks(workingDirectory()).keys()]),
  })
}

export async function runReviewCommand(
  arg: string,
  ctx: { getSessionId: () => string },
  deps: ReviewCommandDeps,
): Promise<void> {
  const { setToast, setReviewResult } = deps
  const reviewCfg = resolveEffectiveConfig({ cwd: workingDirectory() })
  setToast({ message: `>> Code review started <<`, variant: 'info' })
  const { shutdown, uninstallSignals: detach } = reviewShutdown(setToast)
  try {
    const surfaceHooks = await hookChain(reviewCfg.hooks)
    const result = await runReview(arg, {
      git: createGitRunner({
        timeoutMs: reviewCfg.shell_timeout_ms,
        // The TUI owns the screen: a toast, not a stderr write that would paint over the frame.
        onWarn: (m) => setToast({ message: m, variant: 'info' }),
      }),
      createAgent: createReviewAgent({
        config: reviewCfg,
        cwd: workingDirectory(),
        credential: async (model) =>
          await resolveCredentialForModel(model, { env: process.env, home: homedir() }),
        hooks: surfaceHooks,
        registerCleanup: (fn) => {
          // Named for the framework's watchdog, which reports WHICH cleanup hung.
          shutdown.register({ name: 'discard-review', run: fn })
        },
      }),
    })
    process.stderr.write(
      `[review] findings=${result.output.findings.length} verdict=${result.output.overall_correctness}\n`,
    )
    setReviewResult(result.rendered)
    await Agent.injectSessionTurn(ctx.getSessionId(), {
      userText: `<user_action><context>User initiated a review task (${result.target.hint}). User may reference the findings below in follow-ups.</context><action>review</action><results>${result.rendered}</results></user_action>`,
      assistantText: result.rendered,
    }).catch((e: unknown) => {
      process.stderr.write(
        `[review] inject skipped: ${e instanceof Error ? e.message : String(e)}\n`,
      )
    })
    setToast({
      message: `<< Code review finished: ${result.target.hint} — ${result.output.findings.length} finding(s); ${result.output.overall_correctness || 'no verdict'} >>`,
      variant: 'success',
    })
  } catch (err) {
    setToast({
      message: `/review failed: ${err instanceof Error ? err.message : String(err)}`,
      variant: 'error',
    })
  } finally {
    detach()
  }
}
