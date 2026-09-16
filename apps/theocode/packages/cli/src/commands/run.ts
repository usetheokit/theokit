import process from 'node:process'
import { createGitRunner } from '@theocode/shared/git-runner'

import {
  createHumanProcessor,
  createJsonlProcessor,
  type ExecProcessor,
  silentEmptyTurnDiagnostic,
} from '../runtime/index.js'
import { consumeWithForkIfBusy, availableIdOrFork } from '../runtime/index.js'
import { DEFAULT_WATCHDOG_MS } from '@theokit/agents/commands'
import { createDrainedProcessOutput } from '../runtime/index.js'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import type { ExecRun } from '../runtime/index.js'
import type { Shutdown } from '@theokit/agents/commands'
import { resolveSession } from '../runtime/index.js'
import { fireSessionStart } from '../runtime/session-start.js'
import { diagnosticsEnabled } from '@theocode/shared/diagnostic-sink'
import { turnFailureReporting, type TurnFailureHooks } from '@theocode/shared/turn-failure-reporting'

function readPrompt(args: ExecRun): string {
  if (args.stdinBehavior === 'required' || args.stdinBehavior === 'forced') {
    const lido = readFileSync(0, 'utf8').trim()
    if (lido.length === 0) {
      process.stderr.write('No prompt provided\n')
      process.exit(1)
    }
    return lido
  }
  const base = args.prompt ?? ''
  if (args.stdinBehavior !== 'append') return base
  const stdin = readFileSync(0, 'utf8').trim()
  return stdin.length > 0 ? `${base}\n\n<stdin>\n${stdin}\n</stdin>` : base
}

/**
 * #29 — the git seam behind the end-of-turn diff, with the reason ROUTED rather than dropped.
 *
 * `git-runner.ts` made `onWarn` required and said why: "making the callback mandatory means a
 * future caller cannot rebuild the silence by omitting an optional argument". This call site
 * rebuilt it anyway, by supplying `() => {}`. It is the one of four in `packages/` that did.
 *
 * The cost was visible in the output, not only in principle: `turn-diff.ts` renders a failed call
 * as "the changes to N file(s) could not be shown: " plus a detail git writes to STDERR — which
 * this seam is the only thing that sees. So the sentence ended on a colon, and the operator was
 * told the diff was unavailable and never why.
 *
 * `timeoutMs` stays a parameter for the reason `git-runner.ts` gives for not making it a constant:
 * the duplicated `10_000` literal was the original finding, and a shared constant would have moved
 * it rather than removed it. The caller passes the project's own `shell_timeout_ms`, as
 * `commands/review.ts` already did.
 */
export function createDiffGit(
  timeoutMs: number,
  err: (line: string) => void,
): ReturnType<typeof createGitRunner> {
  return createGitRunner({
    timeoutMs,
    onWarn: (m) => {
      err(`[diff] ${m}`)
    },
  })
}

/**
 * #30 — one stream OPEN is one turn, so the retry count starts at zero on each.
 *
 * `turnFailureReporting` bundles three members so that none can be wired without the others, and
 * the sole production consumer wired two: `startTurn` had a test and no caller. That is not inert
 * here — `session-busy.ts` opens a SECOND stream on the same hooks when the session is contended,
 * so a `rate_limit` spent on the first pass was still being counted into the second turn's error
 * text. "After 3 attempts" on a turn that made one is the false attribution `RetryRecord.startTurn`
 * exists to prevent.
 *
 * Wrapping the opener rather than calling `startTurn()` once before the consume: the fork is opened
 * inside `consumeWithForkIfBusy`, where this caller has no line to put it on, and a reset that only
 * covers the first attempt would leave exactly the case that was wrong.
 */
export function perTurnStream(
  failure: TurnFailureHooks,
  open: (sessionId: string) => AsyncIterable<unknown>,
): (sessionId: string) => AsyncIterable<unknown> {
  return (sessionId) => {
    failure.startTurn()
    return open(sessionId)
  }
}

function createProcessor(
  json: boolean,
  sessionId: string,
  shellTimeoutMs: number,
): ExecProcessor {
  const io = {
    out: (l: string) => process.stdout.write(`${l}\n`),
    err: (l: string) => process.stderr.write(`${l}\n`),
  }
  // #105 — the human surface ends a turn with what the tree now holds. NOT the JSONL one: its
  // consumers parse a stream of typed events, and a diff has no event type — appending it would
  // hand a machine reader an unannounced shape. A `--json` consumer that wants the diff already has
  // the repository in front of it.
  return json
    ? createJsonlProcessor(io, sessionId)
    : createHumanProcessor(io, sessionId, createDiffGit(shellTimeoutMs, io.err))
}

/**
 * Resolve the credential and the model id the turn will actually run on.
 *
 * Extracted from `runCommand` because it is a self-contained decision with its own long reason, and
 * because that reason is about CREDENTIAL ROUTING rather than about running a turn — keeping it
 * inline made the caller read as if the routing order were part of the turn loop.
 */
/**
 * The three seams the ordering below depends on, injectable so the order can be ASSERTED.
 *
 * B-141 — the order is what `run.ts` calls "the fix", it cost a real user a misdiagnosed turn, and
 * nothing tested it: it survived as a comment over dynamic imports no test could reach. Production
 * passes nothing and gets the real modules.
 */
export interface RunTargetDeps {
  readonly resolveCredentialForModel: typeof import('@theocode/agent/auth').resolveCredentialForModel
  readonly routeToCredential: typeof import('@theocode/agent/auth').routeToCredential
  readonly composeRun: typeof import('../run-composition.js').composeRun
}

export async function resolveRunTarget(args: ExecRun, injected?: RunTargetDeps) {
  const { composeRun, resolveCredentialForModel, routeToCredential } =
    injected ??
    (await (async () => {
      const auth = await import('@theocode/agent/auth')
      const composition = await import('../run-composition.js')
      return {
        composeRun: composition.composeRun,
        resolveCredentialForModel: auth.resolveCredentialForModel,
        routeToCredential: auth.routeToCredential,
      }
    })())

  // The ORDER here is the fix, and it is the TUI's order: route the model id for the credential
  // that will serve it, THEN resolve a credential for the routed id, THEN build on that same id.
  //
  // Headless used to resolve and build on the configured id directly. With a ChatGPT sign-in that
  // id is `openai/…`, which selects the API-key provider — and `api.openai.com` refuses an OAuth
  // token outright (`401 Missing scopes: api.responses.write`, measured 2026-08-25 by posting to
  // both endpoints with the stored token). So one credential worked in the TUI and failed in the
  // CLI, on a product whose README calls itself "one agent core, two surfaces". Worse, the failure
  // did not say `auth`: after the transport's retries it surfaced as `rate_limit (HTTP 429)`, which
  // reads as a quota problem and sends the user off to check a usage page.
  //
  // The first resolution is a PROBE: `routeToCredential` needs to know whether the credential is an
  // OAuth one before it can decide, and that answer only comes from resolving. It is cheap (a file
  // read plus, at most, a token refresh) and the second call reuses the refreshed token.
  const probe = await resolveCredentialForModel(args.model, { env: process.env, home: homedir() })
  const {
    cfg,
    policy: headlessPolicy,
    mod,
    model,
  } = await composeRun({
    ...args,
    routeModel: (id) => routeToCredential(probe, id),
  })
  const cred = await resolveCredentialForModel(model, { env: process.env, home: homedir() })
  // `model` is deliberately not returned: it is consumed here and nowhere else, and a value
  // nobody reads is the dead surface the audit that produced B-128..B-134 exists to find.
  //
  // #29 — `shellTimeoutMs` IS read, by the diff runner below. Taken from the composition rather
  // than resolved again: the config was already read to build the agent, and a second read could
  // legitimately answer differently.
  return { headlessPolicy, mod, apiKey: cred.apiKey, shellTimeoutMs: cfg.shell_timeout_ms }
}

/**
 * Resolve the session and, when resolving it STARTED one, fire `SessionStart`.
 *
 * The decision comes from the RESOLUTION, not from the arguments: `resume --last` carries no
 * explicit id, and a rule that read that as "new session" fired the hook on a resume, with the
 * previous turn's id — measured on the bench, and the reason `resolveSession` returns both facts.
 */
async function openSession(args: ExecRun): Promise<string> {
  const resolved = await resolveSession(args)
  const sessionId = availableIdOrFork(resolved.id, process.cwd())
  if (resolved.started) await fireSessionStart(sessionId, process.cwd())
  return sessionId
}

export async function runCommand(args: ExecRun, shutdown: Shutdown): Promise<void> {
  const prompt = readPrompt(args)

  const { streamAgentTurnInProcess } = await import('@theokit/agents')
  const { headlessPolicy, mod, apiKey, shellTimeoutMs } = await resolveRunTarget(args)

  const sessionId = await openSession(args)
  const processor = createProcessor(args.json === true, sessionId, shellTimeoutMs)

  let status: 'finished' | 'error' = 'finished'
  let errorMsg: string | undefined
  // Named, because the framework's watchdog reports WHICH cleanup hung, not merely that one did.
  shutdown.register({
    name: 'finish-processor',
    run: () => {
      processor.finish('error', { error: 'interrupted' })
    },
  })
  try {
    // B-130 — the transport's retries were invisible: after three attempts an auth failure reached
    // the user as `rate_limit (HTTP 429)` (see the ORDER note above, which fixed that specific
    // case). The count comes from the SDK's own `rate_limit` event, not from anything invented here.
    const failure = turnFailureReporting({ diagnosticsEnabled })
    const openStream = perTurnStream(failure, (sessionId) =>
      streamAgentTurnInProcess(mod, apiKey, {
        message: prompt,
        sessionId: sessionId,
        awaitApproval: async () => headlessPolicy,
        // Without this the framework masks every failure to "An error occurred." — the right
        // default for a public HTTP endpoint and the wrong one here, where the caller IS the
        // operator. See `@theocode/shared/turn-error`.
        onError: failure.onError,
        // The only member read is `rate_limit`; every other event is ignored, the same discipline
        // the TUI's MCP sink applies to the same stream.
        onRunEvent: failure.onRunEvent,
      }) as AsyncIterable<unknown>,
    )
    await consumeWithForkIfBusy(
      sessionId,
      openStream,
      (chunk) => {
        processor.process(chunk as never)
      },
      (line) => process.stderr.write(line),
    )
  } catch (err) {
    status = 'error'
    errorMsg = err instanceof Error ? err.message : String(err)
  }
  const result = processor.finish(status, errorMsg !== undefined ? { error: errorMsg } : {})
  const emptyTurn = silentEmptyTurnDiagnostic(result, status)
  if (emptyTurn !== undefined) process.stderr.write(`${emptyTurn}\n`)
  if (args.outputLastMessage !== undefined) {
    try {
      writeFileSync(args.outputLastMessage, `${result.finalText}\n`)
    } catch (err) {
      process.stderr.write(
        `failed to write -o file: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }
  // B-142 — the CLI deliberately does NOT collect.
  //
  // It used to, awaited, after the answer was delivered. That was measured as a 4.9-37.1 s hang
  // before exit on a large tree — invisible in a script except as a stall. A one-shot process cannot
  // host a background sweep either: it exits before the child finishes and kills it halfway.
  //
  // So collection belongs to the long-lived surface (the TUI spawns a child), and `sessions gc`
  // remains here as the explicit command it always was.
  const drainedExit = createDrainedProcessOutput(DEFAULT_WATCHDOG_MS)
  drainedExit(result.errorSeen || emptyTurn !== undefined ? 1 : 0)
}
