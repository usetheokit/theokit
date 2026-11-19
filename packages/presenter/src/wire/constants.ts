// Wire constants, kept free of `zod` so the root entry can import them (see
// tests/root-entry-has-no-runtime-peers.test.ts).

/**
 * The literal discriminators this package speaks, in declaration order.
 *
 * diffs this list against the `ai` union to notice a variant that
 * appeared upstream and that we have not mirrored. It is exported (rather than derived at the call
 * site) so the gate and the schema cannot drift apart — a gate comparing a stale list is a gate
 * whose verdict means nothing.
 */
export const WIRE_CHUNK_TYPES: readonly string[] = [
  'start',
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-input-available',
  'tool-output-available',
  'tool-output-error',
  'tool-approval-request',
  'error',
  'finish',
]

/** `data-*` parts are matched by shape, not by an enumerated name — the family is open by design. */
export const WIRE_DATA_PART_PREFIX = 'data-'

/**
 * The `data-*` part that says WHAT a `tool-approval-request` is asking — usetheokit/theokit#394.
 *
 * `{ type: 'data-approval', data: { approvalId, question?, timeoutMs? }, transient: true }`, emitted
 * immediately before the approval frame it describes. The reader folds it into the same tool part,
 * under `approval`, so a consumer never sees it as a part of its own.
 *
 * ## Why a `data-*` part and not two more fields on the approval frame
 *
 * Because the approval frame is shared vocabulary and `ai`'s validator for it is strict — see the
 * note on that variant above. `data-*` is the one arm of this union that is open by contract on
 * BOTH sides: `ai` validates `data-${string}` with an arbitrary payload, and `transient: true`
 * makes its reader discard the part rather than render it. Measured against `ai@7.0.14`: the frame
 * parses, the transcript is byte-identical with and without it, and the approval still reconstructs
 * as `state: 'approval-requested'`. So the extension costs an ai client nothing and costs ours a
 * lookup.
 *
 * The precedent is `data-checkpoint`, which carries a framework signal the same way and for the
 * same reason (`render-terminal.ts`: "a FRAMEWORK signal carried as a `data-*` part, not agent
 * output").
 *
 * Exported so the producer (`@theokit/agents`) and the reader name it once. Two ends agreeing on a
 * string literal by coincidence is how a wire silently stops carrying something.
 */
export const WIRE_APPROVAL_DETAIL_PART = 'data-approval'

/**
 * The transient `data-*` part saying a tool call was REFUSED, emitted just before that call's
 * `tool-output-error`: `{ type: 'data-tool-refusal', data: { toolCallId, by, reason? }, transient: true }`.
 * The reader folds it into the tool part as `refusal`. Carried as `data-*` for the same reason as
 * {@link WIRE_APPROVAL_DETAIL_PART}: the error frame's schema is strict.
 */
export const WIRE_TOOL_REFUSAL_PART = 'data-tool-refusal'

/**
 * The `data-*` part carrying a failed turn's error `code`, emitted just before the `error` frame.
 *
 * `{ type: 'data-error-code', data: { code } }`. The code cannot ride on the `error` chunk itself
 * (`ai`'s strict schema rejects extra keys), so it travels as its own part. Exported so the
 * producer (`@theokit/agents`) and the reader (`createWireReader`) name it once.
 */
export const WIRE_ERROR_CODE_PART = 'data-error-code'
