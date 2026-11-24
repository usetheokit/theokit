import { classifyTurnFailure, describeTurnFailure } from '@theokit/agents/errors'
import type { TurnFailure } from '@theokit/agents/errors'

/**
 * Built on `describeTurnFailure` (`@theokit/agents/errors`), which owns the layout:
 * `"<message> [<code>]: <hint>"`, then `after N attempts`, then a suffix. What stays here is the
 * product's own: the hint table below, handed over as a `probe` so it wins over the framework's
 * default wording. The probe answers `''` when this product has no hint, so a code it never hinted
 * (`server_error`, `invalid_request`) stays unhinted instead of inheriting a framework default.
 *
 * What a failed turn TELLS the user.
 *
 * The framework masks by default — `presentUIMessageStream` uses `opts.onError ?? MASK_ERROR`, and
 * `MASK_ERROR` is the fixed string `"An error occurred."`. Neither surface passed `onError`, so
 * every failure in this product, from either surface, rendered as those three words.
 *
 * Measured 2026-08-25. `theocode run "reply PONG"` printed:
 *
 *     ERROR: An error occurred.
 *     [exec] session=exec-… status=error tokens=0
 *
 * The real cause was `RateLimitError`, and the ONLY way to see it was
 * `THEOCODE_DIAGNOSTICS=stderr` — an environment variable the failure message does not mention:
 *
 *     retry 1/3 in 20ms — RateLimitError
 *     retry 2/3 in 403ms — RateLimitError
 *     ERROR: An error occurred.
 *
 * The default is right for the transport it was written for. Masking exists so a public HTTP
 * endpoint does not leak server internals to a caller who is not the operator. In THIS product the
 * caller IS the operator: it runs on their machine, against their credential, and there is nobody
 * else to protect the detail from. `rules/error-handling.md` § 5 already names this shape as an
 * anti-pattern: a generic message ("an unexpected error occurred") tells nobody what failed or
 * what to do about it.
 *
 * So the surfaces opt out, in one place, rather than each deciding.
 */

/**
 * Failures common enough to be worth a next step rather than only a name.
 *
 * Matched on the SDK's typed error CODE first, and on the message only as a fallback for a provider
 * that supplies none. Message matching is a heuristic and is kept to a substring that names an error
 * class, never a phrase that could be reworded upstream without anyone noticing.
 *
 * The code half was DESCRIBED here and not implemented until 2026-09-04. The probe concatenated code
 * and message and ran the text patterns over both, so a typed code only matched when its own string
 * happened to look like one — measured across the eleven `ErrorCode` values of
 * `@theokit/sdk@4.63.4-next.0`, exactly one did (`rate_limit`), and the other ten produced no hint at
 * all. The one that matters is `auth_failed`: a refused credential reported the bare message and no
 * next step, while the same failure with a raw `401` in its text got the hint. That is B-149's
 * remaining half — upstream now keeps the class distinct, and this side was throwing it away.
 */
const HINTS: readonly {
  /** The SDK codes this hint answers. Checked before the message. */
  readonly codes?: ReadonlySet<string>
  readonly matches: (probe: string) => boolean
  readonly hint: string
}[] = [
  {
    codes: new Set(['rate_limit']),
    matches: (p) => p.includes('ratelimit') || p.includes('rate_limit') || p.includes('429'),
    hint: 'the provider is rate-limiting this account — wait and retry, or switch model with /model',
  },
  {
    codes: new Set(['auth_failed']),
    matches: (p) =>
      p.includes('401') ||
      p.includes('unauthor') ||
      p.includes('invalid_api_key') ||
      p.includes('authenticationerror'),
    hint: 'the credential was refused — run `theocode doctor`, then /login to re-authenticate',
  },
  {
    codes: new Set(['network', 'timeout']),
    matches: (p) =>
      p.includes('econnrefused') || p.includes('enotfound') || p.includes('etimedout'),
    hint: 'the provider could not be reached — check the network, then retry',
  },
  {
    /**
     * Deliberately NOT folded into the rate-limit entry above. Both are "the provider said no", and
     * the actions are opposites: rate limiting clears by waiting, an exhausted quota does not, so
     * sending the user to wait would be sending them to wait out a condition that never resolves.
     */
    codes: new Set(['quota_exceeded']),
    matches: (p) => p.includes('quota'),
    hint: 'the account quota is exhausted — waiting will not clear it; check billing, or switch model with /model',
  },
  {
    codes: new Set(['model_unavailable']),
    matches: () => false,
    hint: 'the provider does not have this model right now — switch with /model',
  },
  {
    codes: new Set(['context_too_long']),
    matches: (p) => p.includes('context') && p.includes('length'),
    hint: 'the conversation outgrew the model window — /compact frees context',
  },
  {
    /**
     * The hint that cost two sessions hours before it existed (#133).
     *
     * A turn failed with `provider "…" does not support image content in tool results` immediately
     * after the user attached an image with `/image`, and the natural reading — "my attachment is
     * unsupported" — is wrong. Measured in the provider mapper: the guard is reachable ONLY from a
     * part whose type is `tool_result`, and it inspects the content INSIDE it. An attachment is an
     * `image` part of a user message and takes the `input_image` branch, never reaching the guard.
     *
     * So whenever this error appears, a TOOL returned image content — which is an assertion this
     * hint can make because the guard has exactly one reachable caller.
     *
     * The second half is why nobody could see it: the transcript collapses tool activity to
     * `Used 1 tool` unless `ctrl+o` is pressed, so the run that failed looked identical to the five
     * that passed. The answer was one keystroke away and nothing said so.
     *
     * Matched on the message rather than a code: `ConfigurationError` covers far more than this, and
     * claiming a tool ran on every configuration error would be the fabrication this hint exists to
     * prevent. The substring names the error's own subject, not a phrase that could be reworded.
     */
    matches: (p) => p.includes('image content in tool results'),
    hint:
      'a tool returned an image and this provider carries tool results as text only — ' +
      'ctrl+o shows which tool ran; the attachment itself is fine',
  },
]

/**
 * The text a surface shows for a failed turn: what happened, and where known, what to do about it.
 *
 * Never empty. A blank line where the reason should be is the same defect as the fixed string it
 * replaces — the user still learns nothing, and now nothing looks wrong either.
 */
/**
 * What the surface knows about the turn that the error object does not carry.
 *
 * Both fields are optional and absent means UNKNOWN, never `false`. A surface that has not been
 * wired yet keeps the old text rather than advertising a state nobody checked.
 */
export interface TurnErrorContext {
  /**
   * The highest attempt the provider reached, from `createTurnRetries` (`@theokit/agents/errors`).
   *
   * `0` or `1` is not a retry and is not reported: a single attempt IS the turn, and "after 1
   * attempt" on every ordinary failure is the noise that gets a message skipped.
   */
  readonly attempts?: number
  /**
   * Whether the diagnostics sink is installed, from `installDiagnosticSink`'s return value.
   *
   * When it is OFF the failure names the variable; when it is already ON, saying so would tell the
   * operator to turn on what they turned on.
   */
  readonly diagnosticsEnabled?: boolean
}

const DIAGNOSTICS_HINT =
  'set THEOCODE_DIAGNOSTICS=stderr to see the retry sequence and the underlying error'

/**
 * The next step for a failure, or `''` when there is no honest one to give (the framework treats an
 * empty hint as none, where `undefined` would fall through to its own defaults).
 *
 * The typed code first, the message only when no hint claimed the code. `unknown` means the SDK could
 * not classify the failure, and inventing a next step for it would be a guess dressed as guidance.
 */
function probeHint(failure: TurnFailure): string {
  const code = failure.rawCode
  const text = `${code ?? ''} ${failure.message}`.toLowerCase()
  const byCode = code === undefined ? undefined : HINTS.find((h) => h.codes?.has(code))
  return (byCode ?? HINTS.find((h) => h.matches(text)))?.hint ?? ''
}

export function turnErrorText(
  error: { message: string; code?: string },
  context: TurnErrorContext = {},
): string {
  const failure = classifyTurnFailure(error)
  const attempts = context.attempts ?? 0
  // Order is deliberate and pinned by a test: what happened, then what to do, then the context. The
  // original defect was a user left with nothing to act on, so nothing may push the message down.
  return describeTurnFailure(failure, {
    attempts,
    probe: probeHint,
    ...(context.diagnosticsEnabled === false ? { suffix: `— ${DIAGNOSTICS_HINT}` } : {}),
  })
}
