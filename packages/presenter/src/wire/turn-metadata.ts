import { z } from 'zod'
import type { WireChunk } from './chunk-schema.js'

/** Why a turn was cut short. Mirrors the agents runtime's `AgentStopReason`. */
export type WireStopReason = 'step_limit' | 'no_progress'

/** The typed shape of a `finish` chunk's `messageMetadata`. Every field is optional. */
export interface WireTurnMetadata {
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
    readonly reasoningTokens?: number
  }
  readonly cost?: number
  readonly durationMs?: number
  readonly stopReason?: WireStopReason
  readonly model?: string
}

const num = z.number().finite()
const USAGE_KEYS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
] as const
const stopReasonSchema = z.enum(['step_limit', 'no_progress'])
const recordSchema = z.record(z.string(), z.unknown())

/**
 * The finish chunk's metadata, validated field by field: a field of the wrong type is dropped, not
 * thrown on, because the wire is untrusted. Undefined for any other chunk, or a finish without
 * object metadata.
 */
export function readTurnMetadata(chunk: WireChunk): WireTurnMetadata | undefined {
  if (chunk.type !== 'finish') return undefined
  const meta = recordSchema.safeParse(chunk.messageMetadata)
  if (!meta.success) return undefined
  const raw = meta.data
  const out: {
    -readonly [K in keyof WireTurnMetadata]: WireTurnMetadata[K]
  } = {}

  const usage = recordSchema.safeParse(raw.usage)
  if (usage.success) {
    const u: Record<string, number> = {}
    for (const key of USAGE_KEYS) {
      const v = num.safeParse(usage.data[key])
      if (v.success) u[key] = v.data
    }
    out.usage = u
  }
  const cost = num.safeParse(raw.cost)
  if (cost.success) out.cost = cost.data
  const durationMs = num.safeParse(raw.durationMs)
  if (durationMs.success) out.durationMs = durationMs.data
  const stopReason = stopReasonSchema.safeParse(raw.stopReason)
  if (stopReason.success) out.stopReason = stopReason.data
  const model = z.string().safeParse(raw.model)
  if (model.success) out.model = model.data
  return out
}
