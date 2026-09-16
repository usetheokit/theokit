import process from 'node:process'
import { createGitRunner } from '@theocode/shared/git-runner'
import type { ExecReview } from '../runtime/index.js'
import type { Shutdown } from '@theokit/agents/commands'

export async function reviewCommand(args: ExecReview, shutdown: Shutdown): Promise<void> {
  const approvalRequested = args.overrides.some((o) => o.startsWith('approval_policy'))
  if (approvalRequested) {
    process.stderr.write(
      'ERROR: `-a/--approval` does not apply to `review` mode: the reviewer receives no write tool ' +
        '(`apply_patch`/`edit_file`), so there is no action to approve. Remove the flag.\n',
    )
    process.exit(2)
  }

  const { runReview } = await import('@theocode/agent/review')
  const { createReviewAgent } = await import('@theocode/agent/review')
  const { resolveCredentialForModel } = await import('@theocode/agent/auth')
  const { resolveEffectiveConfig } = await import('@theocode/agent/config')
  const { homedir } = await import('node:os')
  const execCfg = resolveEffectiveConfig({ cwd: process.cwd(), cli: args.overrides })
  const { parseHooks, buildHookHandlers, loadApprovedHooks } = await import('@theocode/agent/hooks')
  const { resolveTrustPosture } = await import('@theocode/agent/config')
  const hookSpecs = parseHooks(execCfg.hooks)
  const surfaceHooks = buildHookHandlers(hookSpecs, {
    trusted: resolveTrustPosture(process.cwd()).allows.hooks,
    approved: new Set([...loadApprovedHooks(process.cwd()).keys()]),
  })

  try {
    const result = await runReview(args.target, {
      git: createGitRunner({
        timeoutMs: execCfg.shell_timeout_ms,
        // Headless: the reason goes to stderr, where the JSON on stdout stays parseable.
        onWarn: (m) => process.stderr.write(`[review] ${m}\n`),
      }),
      createAgent: createReviewAgent({
        config: execCfg,
        cwd: process.cwd(),
        credential: async (model) =>
          await resolveCredentialForModel(model, { env: process.env, home: homedir() }),
        hooks: surfaceHooks,
        // Named for the framework's watchdog, which reports WHICH cleanup hung. Wrapped rather than
        // passed by reference: `register` is a method, and handing it over bare unbinds `this`.
        registerCleanup: (fn) => {
          shutdown.register({ name: 'discard-review', run: fn })
        },
      }),
    })
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ type: 'review.completed', ...result.output })}\n`)
    } else {
      process.stdout.write(`${result.rendered}\n`)
    }
    process.stderr.write(
      `[exec] review findings=${result.output.findings.length} verdict=${result.output.overall_correctness}\n`,
    )
    process.exit(0)
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
