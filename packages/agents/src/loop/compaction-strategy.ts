/**
 * TranscriptCompactionStrategy — a named, callable transcript-compaction authoring layer
 * (Strategy pattern, V4-F). Mirrors `ReflectionStrategy`/`LoopStrategy`: interface
 * + zod config schema + a `'token-budget'` default + `resolveCompactionStrategy`.
 *
 * The `'token-budget'` strategy DELEGATES to the SDK's `compactTranscript` (ADR D2 /
 * G2 / sdk-runtime.md — the SDK owns the algorithm; agents owns the named interface;
 * no reimplementation). Per ADR D1 it is CALLABLE by the app (exposed as
 * `AgentRunner.compaction`), NOT auto-invoked by the reflective loop — the SDK owns
 * per-turn context, so the app decides WHEN to compact and supplies the `summarize`
 * callback (its own LLM). EC-6: consumers whose transcript rows carry roles outside
 * the SDK's `CompressibleMessage` union (e.g. `'tool'`) cast at the call site, exactly
 * as the SDK's own type contract requires.
 *
 * referencia: knowledge-base/references/mastra compaction (named strategy over a budget).
 */
import { compactTranscript, type CompressibleMessage } from '@theokit/sdk/compaction'
import { z } from 'zod'

export type { CompressibleMessage }

/** Token budget mirrored from theocode's proven `DEFAULT_KEEP_TOKENS` (server/lib/compaction.ts). */
export const DEFAULT_KEEP_TOKENS = 8000

/**
 * App-supplied summarizer: collapse the older window into one turn (the app's LLM).
 * Signature matches the SDK `compactTranscript` contract — receives the older window
 * AND the (optionally overridden) summary template.
 */
export type Summarize = (
  older: CompressibleMessage[],
  template: string,
) => Promise<CompressibleMessage>

/**
 * Per-call options for {@link TranscriptCompactionStrategy.compact} — a faithful
 * pass-through of the SDK `CompactTranscriptOptions` knobs the app controls. Defaults
 * are the SDK's, EXCEPT `failSafe` which defaults `true` here: a thrown `summarize`
 * returns the ORIGINAL transcript + a structured warn instead of losing it — compaction
 * is an optimization, never a cause of data loss (error-handling discipline). The app
 * passes `failSafe: false` to opt into fail-fast propagation.
 */
export interface CompactionCallOptions {
  /** Override the strategy's configured `keepTokens` for this call. */
  readonly keepTokens?: number
  /** Summarize the older window; if omitted, the SDK drops it (its documented contract). */
  readonly summarize?: Summarize
  /** Checkpoint marker (SDK default when omitted). */
  readonly marker?: string
  /** Summary template passed to `summarize` (SDK default when omitted). */
  readonly summaryTemplate?: string
  /** When true (DEFAULT here), a thrown `summarize` returns the original transcript + a warn. */
  readonly failSafe?: boolean
}

/** A named, callable compaction strategy. Pure of I/O except the delegated SDK call. */
export interface TranscriptCompactionStrategy {
  /** Strategy identifier (e.g. `'token-budget'`). */
  readonly name: string
  /** The configured token budget (from `@Compaction` / `.compaction()` / default). */
  readonly keepTokens: number
  /**
   * Compact `messages` to the (optionally overridden) token budget via the SDK's
   * `compactTranscript`. Returns the compacted transcript; never mutates the input.
   */
  compact(
    messages: CompressibleMessage[],
    options?: CompactionCallOptions,
  ): Promise<CompressibleMessage[]>
}

/**
 * Serializable config for a TranscriptCompactionStrategy (SSoT per type-safety.md / G3).
 * `keepTokens` is REQUIRED for `'token-budget'` (EC-2 / G10 — no silent degradation
 * to the SDK's turn-count `keepRecent` default; the strategy is named for token budget).
 */
export const compactionStrategyConfigSchema = z.object({
  name: z.literal('token-budget'),
  keepTokens: z.number().int().positive(),
})

export type CompactionStrategyConfig = z.infer<typeof compactionStrategyConfigSchema>

/**
 * Resolve a `@Compaction` / `.compaction()` declaration to a concrete strategy.
 * Throws (Zod) on an unknown name or a missing/invalid `keepTokens` (EC-2/EC-5 —
 * fail-fast, mirrors `resolveLoopStrategy`). The returned strategy's `compact`
 * delegates to `compactTranscript`, defaulting `keepTokens` to the configured value.
 */
export function resolveCompactionStrategy(
  name: string,
  config: { keepTokens?: number },
): TranscriptCompactionStrategy {
  const cfg = compactionStrategyConfigSchema.parse({ name, keepTokens: config.keepTokens })
  return {
    name: cfg.name,
    keepTokens: cfg.keepTokens,
    compact: (messages, options) =>
      compactTranscript(messages, {
        keepTokens: options?.keepTokens ?? cfg.keepTokens,
        summarize: options?.summarize,
        marker: options?.marker,
        summaryTemplate: options?.summaryTemplate,
        // Default-safe: a thrown summarize keeps the transcript (app opts out via failSafe:false).
        failSafe: options?.failSafe ?? true,
      }),
  }
}

/**
 * The default `'token-budget'` strategy (what `@Compaction('token-budget')` without
 * an explicit budget resolves to). Carries {@link DEFAULT_KEEP_TOKENS}; the app may
 * override per call via `compact(messages, { keepTokens })`.
 */
export const tokenBudgetCompactionStrategy: TranscriptCompactionStrategy =
  resolveCompactionStrategy('token-budget', { keepTokens: DEFAULT_KEEP_TOKENS })
