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
