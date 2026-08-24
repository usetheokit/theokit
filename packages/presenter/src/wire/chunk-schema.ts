import { z } from 'zod'

/**
 * The wire chunk union — TheoKit's own declaration of the `UIMessageStream` frame set.
 *
 * ## Why this exists (plan `remove-ai-dependency`, D1 + D6)
 *
 * The frame FORMAT is unchanged — a TheoKit server and an ai-sdk client still understand each
 * other. What changed is ownership: the union and its validation live here instead of arriving
 * from the `ai` package, so no consumer installs ai-sdk on our account.
 *
 * This reverses `ADR-0050 D1` and opens a deliberate exception to Unbreakable Rule 9. The exception
 * is only defensible because of the differential oracle (`tests/wire/differential.test.ts`): `ai`
 * stays a devDependency and every mirrored variant is proven byte-equivalent against it. Without
 * that oracle a hand-written mirror is strictly worse than the dependency — it fails silently in
 * production instead of loudly at install.
 *
 * ## Why only these variants (D2)
 *
 * The set is MEASURED, not copied. `UIMessageStreamPresenter` emits 12 of them; the agents bridge
 * adds `tool-approval-request` and the `data-*` family. The `ai` union carries ~51 — mirroring the
 * other ~29 would be exports with no consumer, which `G7` and the dead-code detector reject, and
 * YAGNI rejects on principle.
 *
 * ## Why objects STRIP unknown keys instead of preserving them
 *
 * The first cut used `z.looseObject` so a frame's unmodelled provider fields (`providerMetadata`,
 * `title`) would survive. Measured cost: the resulting index signature (`[x: string]: unknown`)
 * widens EVERY narrowed property to `unknown`, so `chunk.id` stops being a `string` — 39 type
 * errors across the workspace, in call sites that were correct. That is the type system reporting
 * that the shape is unusable, not a papercut to cast away.
 *
 * So unknown keys are stripped. A frame carrying them still PARSES (nothing is rejected); the extra
 * fields simply do not reach the consumer. Nothing in TheoKit reads them, and the differential
 * oracle is what proves the reconstructed transcript is unaffected.
 */

/**
 * Every `data-*` part shares one shape: `{ type, data, transient? }` (see bridge `dataPart`).
 *
 * `type` is typed as the template literal `` `data-${string}` ``, NOT as `string`. A plain `string`
 * member poisons narrowing across the whole union — TypeScript can no longer exclude this variant
 * when the discriminant is `'text-delta'`, so `chunk.delta` degrades to `unknown` at every call
 * site. Measured: 39 errors in code that was correct.
 */
const dataPartSchema = z.object({
  type: z.custom<`data-${string}`>(
    (v) => typeof v === 'string' && /^data-[a-z][a-z0-9-]*$/.test(v),
  ),
  data: z.record(z.string(), z.unknown()),
  transient: z.boolean().optional(),
})

const fixedChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), messageId: z.string().optional() }),

  z.object({ type: z.literal('text-start'), id: z.string() }),
  z.object({ type: z.literal('text-delta'), id: z.string(), delta: z.string() }),
  z.object({ type: z.literal('text-end'), id: z.string() }),

  z.object({ type: z.literal('reasoning-start'), id: z.string() }),
  z.object({ type: z.literal('reasoning-delta'), id: z.string(), delta: z.string() }),
  z.object({ type: z.literal('reasoning-end'), id: z.string() }),

  z.object({
    type: z.literal('tool-input-available'),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    dynamic: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('tool-output-available'),
    toolCallId: z.string(),
    output: z.unknown(),
  }),
  z.object({
    type: z.literal('tool-output-error'),
    toolCallId: z.string(),
    errorText: z.string(),
  }),

  // HITL — the standalone gate keyed by its own id, distinct from the tool-call id.
  //
  // usetheokit/theokit#394 asked for this variant to be WIDENED with the tool name, the question
  // and the input the producer already holds. It is not, and the reason is measured rather than
  // conservative: `ai`'s `uiMessageChunkSchema` is STRICT. A frame carrying one key it does not
  // declare fails the union outright — verified against `ai@7.0.14` on every variant, not just this
  // one — and `useChat` drops what fails to parse. So a `question` added here would not reach an
  // ai-sdk client with a slightly poorer prompt; it would delete the whole approval frame for that
  // client, and a gated tool would sit in `input-available` forever. That is theokit#392's own
  // symptom, re-created on the other side of the wire to fix its sibling.
  //
  // What the fields want is therefore split by whether the ai vocabulary already carries them:
  //
  //  - `toolName` and `input` need nothing added: `toolCallId` names the `tool-input-available`
  //    chunk the producer emits immediately before this one (synthesised when the runtime had not
  //    announced the call yet — `present-ui-message-stream.ts`), and that chunk carries both. Both
  //    readers fold the two frames into ONE part, so a prompt reads the tool and its arguments off
  //    the same object it reads `approval.id` from. Repeating them here would be two wire fields
  //    for one fact with no rule for which wins when they disagree.
  //  - `question` and `timeoutMs` have no ai counterpart, so they travel as a transient
  //    `data-approval` part ({@link WIRE_APPROVAL_DETAIL_PART}) — the extension point the `data-*`
  //    family exists to be, and the one an ai client validates and then discards.
  //  - `callbackUrl` travels nowhere: `approve(approvalId, …)` owns the settle route per transport
  //    (HTTP path, in-process callback, IPC). Publishing a URL would freeze one transport's path
  //    shape into the wire and offer a second way to settle that no transport implements.
  //  - `payloadSchema` travels nowhere: no surface collects a custom approval payload today, so it
  //    would ship as permanently public with no renderer. Additive later, if one appears.
  //
  // `isAutomatic`/`signature` from the ai-sdk's own variant are absent for the same measured-not-
  // copied reason as the other ~29 unmirrored frames: nothing here produces them.
  z.object({
    type: z.literal('tool-approval-request'),
    approvalId: z.string(),
    toolCallId: z.string(),
  }),

  // `errorText` is optional: a malformed error frame must still be RECOGNISED as an error so the
  // reader can reject. Requiring the field would push it into the discard path and turn a real
  // provider failure into silence — theokit#136 through a side door.
  z.object({ type: z.literal('error'), errorText: z.string().optional() }),

  z.object({ type: z.literal('finish'), messageMetadata: z.unknown().optional() }),
])

export const wireChunkSchema = z.union([fixedChunkSchema, dataPartSchema])

/**
 * A `data-*` transport part, declared as a type rather than inferred.
 *
 * `z.infer` over the `z.custom` discriminant does not narrow: a `switch (chunk.type)` on the union
 * kept degrading every fixed variant's fields to `unknown`. Declaring the member explicitly gives
 * TypeScript the literal template it needs to exclude this arm. The runtime contract still comes
 * from `dataPartSchema` — the split is between what validates (zod) and what narrows (this type),
 * not two competing sources of truth.
 */
export interface WireDataPart {
  readonly type: `data-${string}`
  readonly data: Record<string, unknown>
  readonly transient?: boolean
}

/** A validated frame of the wire. The fixed arms are derived from the schema (`G3`). */
export type WireChunk = z.infer<typeof fixedChunkSchema> | WireDataPart

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
