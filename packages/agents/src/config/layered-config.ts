// Imported from the SDK directly, not from this package's own barrel: these files now LIVE in
// `@theokit/agents`, so `from '@theokit/agents'` would be a package self-reference (and a cycle
// through `src/index.ts`). The barrel re-exports the same SDK symbols for consumers; inside the
// package we reach the source.
import { foldLayers, verifyLayerOrdering } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import type { z } from 'zod'
// These modules moved from `theokit` into `@theokit/agents`, and this package enforces an
// invariant the web package does not: no exported error class extends plain `Error`. A class
// outside the `TheokitAgentError` hierarchy is invisible to `isTransientError` and to any
// consumer catching `instanceof TheokitAgentError` — the exact defect U-11 measured across ten
// classes. `tests/unit/error-taxonomy.test.ts` caught all three the moment they crossed the
// boundary, which is the guard working.

/**
 * M73 — layered configuration, as a parameterised machine.
 *
 * ## The gap this closes
 *
 * The config module answered "load my framework's config file". It published no layering engine, did
 * not let the SDK's through, and said nothing about directory trust. The evidence that this was a
 * real gap and not a scope decision: a repository whose README forbids importing `@theokit/sdk`
 * directly broke its own rule **six times**, and all six reach for config/trust/wiring primitives. A
 * team that breaks its own rule rather than reimplement is the strongest signal that the door, not
 * the willingness, was what was missing.
 *
 * ## What is policy and what is machine
 *
 * The VOCABULARY — which keys exist, which capabilities they grant, TOML or TS — is legitimately
 * policy and stays with the product. The chain machine, the profile merge, the precedence report and
 * the floor are identical in every agent product.
 *
 * The milestone's named risk was generalising too early and freezing another product's vocabulary.
 * The mitigation is structural: **the layer chain is a parameter, never a constant.** No layer name
 * from any consumer appears in this file, and a test asserts it by resolving a chain of names this
 * repository has never heard of.
 *
 * ## Why it composes rather than implements
 *
 * `foldLayers` and `verifyLayerOrdering` are the SDK's, crossed by M67. Re-deriving the fold here
 * would give two answers to "which layer wins", and the two would diverge silently — the exact
 * defect this whole initiative exists to remove. What this adds is what the SDK deliberately does
 * not: provenance per key, and the measured-vs-declared precedence report.
 */

/** One layer of configuration, with the values it contributes. */
export interface ConfigLayer {
  readonly layer: string
  /** Higher wins. Omit across the whole chain to mean "this array is already the order". */
  readonly precedence?: number
  readonly values: Readonly<Record<string, unknown>>
}

/**
 * Where each resolved key came from.
 *
 * For an overwritten key this is the winning layer's name. For an ACCUMULATED key it is every
 * contributing layer, comma-separated — a union has no single winner, and naming only the last one
 * would be a lie about where the other members came from.
 */
export type ProvenancePerKey = Readonly<Record<string, string>>

/**
 * Declared order versus the order the values actually proved.
 *
 * The consumer wrote this check by hand (`measuredPrecedenceChain`) because the engine did not offer
 * it. A layer that declares high precedence and never wins a key is a config nobody is reading —
 * usually a path that does not exist. Silence there is how a broken override survives for months.
 */
export interface PrecedenceReport {
  /** The chain as the caller wrote it. */
  readonly declared: readonly string[]
  /**
   * The layers that actually contributed at least one key, in chain order.
   *
   * PARTICIPATION, not victory. The first draft measured which layers WON a key, and a base
   * `defaults` layer whose every value is later overridden then reported as absent from the measured
   * chain — flagging the most normal arrangement in layered config as a divergence. Being
   * overridden is what a defaults layer is for.
   */
  readonly measured: readonly string[]
  /**
   * Layers declared in the chain that contributed NO key at all.
   *
   * Not the same as "was overridden": being superseded is the normal fate of a defaults layer and
   * says nothing is wrong. Contributing nothing usually means a path that does not exist — a config
   * file nobody is reading — and that is the silence this report exists to break.
   */
  readonly declaredButSilent: readonly string[]
  readonly diverges: boolean
}

export interface LayeredConfigInput<TSchema extends z.ZodType> {
  readonly layers: readonly ConfigLayer[]
  /** Validated AFTER folding — see {@link LayeredConfig.resolve}. */
  readonly schema: TSchema
  /**
   * Keys whose values UNION across layers instead of being overwritten.
   *
   * Opt-in per key, deliberately: some keys are lists a layer adds to (tools, plugins, allowlists)
   * and overwriting them discards what a lower layer contributed — but defaulting to union would
   * silently merge something the caller meant to replace.
   */
  readonly accumulatingKeys?: readonly string[]
}

export interface LayeredConfigResult<TValue> {
  readonly value: TValue
  readonly provenancePerKey: ProvenancePerKey
  readonly precedenceReport: PrecedenceReport
}

/**
 * Raised when a chain is built out of order.
 *
 * Refusing beats sorting silently: a caller who wrote the chain in the wrong order holds a belief
 * about precedence that is wrong, and sorting it for them leaves the belief intact until it produces
 * a surprise somewhere else.
 */
export class LayerOutOfOrderError extends TheokitAgentError {
  override readonly name = 'LayerOutOfOrderError'

  constructor(message: string) {
    // Not retryable: the caller passed layers in the wrong order, and the same call repeats it.
    super(message, { code: 'config_layer_out_of_order', isRetryable: false })
  }
}

/**
 * The layering engine.
 *
 * A class with one static rather than a free function: it is the namespace the config surface hangs
 * from (`LayeredConfig.resolve`), matching the `X.create()` shape the rest of this codebase uses, and
 * it leaves room for the trust-store companion to join the same namespace without a second import.
 */
export const LayeredConfig = {
  /**
   * Fold the chain, validate the result, and report where everything came from.
   *
   * The schema is applied AFTER folding, never per layer. Validating each layer separately would
   * force every file to be complete, which defeats layering: a project override that sets one key
   * would have to restate the whole config.
   *
   * @throws {LayerOutOfOrderError} when a layer does not outrank the one before it.
   */
  resolve<TSchema extends z.ZodType>(
    input: LayeredConfigInput<TSchema>,
  ): LayeredConfigResult<z.infer<TSchema>> {
    assertOrdering(input.layers)

    const accumulating = input.accumulatingKeys ?? []
    const folded = foldLayers(input.layers, accumulating)
    const value = input.schema.parse(folded)

    return {
      value,
      provenancePerKey: buildProvenance(input.layers, accumulating),
      precedenceReport: buildReport(input.layers),
    }
  },
}

/**
 * Delegate the ordering check to the SDK, and re-raise in this layer's vocabulary.
 *
 * The SDK's `LayerOrderError` already names both layers and both precedences — the refusal a reader
 * can act on. Re-wrapping preserves that message while giving consumers of the framework one error
 * type to catch, instead of one that changes with the SDK's internal naming.
 */
function assertOrdering(layers: readonly ConfigLayer[]): void {
  try {
    verifyLayerOrdering(layers)
  } catch (error) {
    throw new LayerOutOfOrderError((error as Error).message)
  }
}

/** The layers that contributed a value for `key`, in chain order. */
function contributorsOf(layers: readonly ConfigLayer[], key: string): string[] {
  return layers.filter((layer) => key in layer.values).map((layer) => layer.layer)
}

function buildProvenance(
  layers: readonly ConfigLayer[],
  accumulating: readonly string[],
): ProvenancePerKey {
  const keys = new Set(layers.flatMap((layer) => Object.keys(layer.values)))
  const provenance: Record<string, string> = {}
  for (const key of keys) {
    const contributors = contributorsOf(layers, key)
    // The LAST contributor in chain order is the winner: `foldLayers` folds in order, so later
    // entries overwrite earlier ones. `.at(-1)` rather than `[length - 1]` because only the former
    // is TYPED as possibly-undefined: without `noUncheckedIndexedAccess` the indexed form promises a
    // `string` the runtime cannot guarantee, and the linter then calls the necessary guard useless.
    const winner = contributors.at(-1)
    if (winner === undefined) continue
    provenance[key] = accumulating.includes(key) ? contributors.join(', ') : winner
  }
  return provenance
}

function buildReport(layers: readonly ConfigLayer[]): PrecedenceReport {
  const declared = layers.map((layer) => layer.layer)

  // Participation, not victory — see the `measured` docblock. A layer counts as measured when it
  // contributed any key, whether or not that value survived the fold.
  const contributed = new Set(
    layers.filter((layer) => Object.keys(layer.values).length > 0).map((layer) => layer.layer),
  )
  const measured = declared.filter((name) => contributed.has(name))
  const declaredButSilent = declared.filter((name) => !contributed.has(name))

  return {
    declared,
    measured,
    declaredButSilent,
    diverges: declaredButSilent.length > 0,
  }
}
