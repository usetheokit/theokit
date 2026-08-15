import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { LayeredConfig, LayerOutOfOrderError } from '../../packages/agents/src/config-entry.js'

/**
 * M73 — the layering engine, as a parameterised machine rather than one product's constants.
 *
 * ## The gap
 *
 * The framework's config module answered "load my framework's config file". It published no layering
 * engine, did not let the SDK's through, and said nothing about directory trust. The evidence that
 * this was a real gap and not a scope decision: a repository whose README forbids importing
 * `@theokit/sdk` directly broke its own rule **six times**, and all six reach for config/trust/wiring
 * primitives.
 *
 * ## What is policy and what is machine
 *
 * The VOCABULARY — which keys, which capabilities, TOML or TS — is legitimately policy, and stays
 * with the product. The chain machine, the profile merge, the precedence report, the floor and the
 * trust store are identical in every agent product.
 *
 * The milestone's named risk is generalising too early and freezing another product's vocabulary.
 * The mitigation is structural and asserted below: **the layer chain is a parameter, never a
 * constant**, and no layer name from any consumer appears in the framework.
 */

const schema = z.object({
  model: z.string(),
  tools: z.array(z.string()).default([]),
  timeout: z.number().default(30),
})

const layers = [
  { layer: 'defaults', precedence: 0, values: { model: 'base', tools: ['a'], timeout: 10 } },
  { layer: 'project', precedence: 10, values: { model: 'project-model', tools: ['b'] } },
  { layer: 'env', precedence: 20, values: { timeout: 99 } },
]

describe('LayeredConfig — the chain is a parameter', () => {
  it('test_higher_precedence_wins_per_key', () => {
    const result = LayeredConfig.resolve({ layers, schema })
    expect(result.value.model).toBe('project-model')
    expect(result.value.timeout).toBe(99)
  })

  it('test_accumulating_keys_UNION_instead_of_overwriting', () => {
    // The distinction that makes this a config engine rather than an object spread: some keys are
    // lists a layer ADDS to (tools, plugins, allowlists) and overwriting them silently discards what
    // a lower layer contributed.
    const result = LayeredConfig.resolve({ layers, schema, accumulatingKeys: ['tools'] })
    expect(result.value.tools).toEqual(['a', 'b'])
  })

  it('test_without_declaring_a_key_accumulating_it_is_overwritten', () => {
    // Counter-proof: accumulation is opt-in per key, so the default cannot silently union something
    // the caller meant to replace.
    const result = LayeredConfig.resolve({ layers, schema })
    expect(result.value.tools).toEqual(['b'])
  })

  it('test_no_consumer_layer_name_is_baked_into_the_framework', () => {
    // The milestone's named risk, asserted structurally. Any chain works, including names this
    // repository has never heard of — if a constant ever appears, this fails.
    const exotic = [
      { layer: 'zzz-vendor-baseline', precedence: 1, values: { model: 'x' } },
      { layer: 'qqq-tenant-override', precedence: 2, values: { model: 'y' } },
    ]
    expect(LayeredConfig.resolve({ layers: exotic, schema }).value.model).toBe('y')
  })
})

describe('provenance — which layer put each key there', () => {
  it('test_every_resolved_key_names_its_winning_layer', () => {
    // Without this, a surprising value sends the operator reading every config file by hand.
    const { provenancePerKey } = LayeredConfig.resolve({ layers, schema })
    expect(provenancePerKey.model).toBe('project')
    expect(provenancePerKey.timeout).toBe('env')
  })

  it('test_an_accumulated_key_names_EVERY_contributing_layer', () => {
    // A union has no single winner, and reporting only the last one would be a lie about where the
    // other members came from.
    const { provenancePerKey } = LayeredConfig.resolve({
      layers,
      schema,
      accumulatingKeys: ['tools'],
    })
    expect(provenancePerKey.tools).toBe('defaults, project')
  })
})

describe('the precedence report — measured vs declared', () => {
  it('test_the_report_states_both_orders', () => {
    // The consumer wrote this check by hand (`measuredPrecedenceChain`) because the engine did not
    // offer it. Declared is what the caller wrote; measured is which layers actually contributed.
    //
    // PARTICIPATION, not victory: the first draft measured which layers WON a key, and a base
    // `defaults` layer whose every value is later overridden then vanished from the measured chain —
    // flagging the most normal arrangement in layered config as a divergence. Being overridden is
    // what a defaults layer is FOR.
    const { precedenceReport } = LayeredConfig.resolve({ layers, schema })
    expect(precedenceReport.declared).toEqual(['defaults', 'project', 'env'])
    expect(precedenceReport.measured).toEqual(['defaults', 'project', 'env'])
    expect(precedenceReport.diverges).toBe(false)
  })

  it('test_divergence_is_REPORTED_not_hidden', () => {
    // A layer that declares high precedence and never wins a key is a config nobody is reading —
    // usually a path that does not exist. Silence there is how a broken override survives for months.
    const withDeadLayer = [
      { layer: 'defaults', precedence: 0, values: { model: 'base', timeout: 10 } },
      { layer: 'never-applies', precedence: 5, values: {} },
      { layer: 'env', precedence: 20, values: { model: 'from-env', timeout: 99 } },
    ]
    const { precedenceReport } = LayeredConfig.resolve({ layers: withDeadLayer, schema })
    expect(precedenceReport.diverges).toBe(true)
    expect(precedenceReport.declaredButSilent).toContain('never-applies')
  })
})

describe('load-time ordering — fails LOUD when the chain is built out of order', () => {
  it('test_a_layer_that_does_not_outrank_its_predecessor_is_refused', () => {
    // The DoD calls for a load-time check that fails high. Refusing beats sorting silently: a caller
    // who wrote the chain in the wrong order has a belief about precedence that is wrong, and
    // sorting it for them leaves the belief intact.
    const outOfOrder = [
      { layer: 'high', precedence: 20, values: { model: 'a' } },
      { layer: 'low', precedence: 5, values: { model: 'b' } },
    ]
    expect(() => LayeredConfig.resolve({ layers: outOfOrder, schema })).toThrow(
      LayerOutOfOrderError,
    )
  })

  it('test_the_refusal_names_BOTH_layers_and_both_precedences', () => {
    // A refusal that only says "out of order" sends the reader to compare the whole list by hand.
    try {
      LayeredConfig.resolve({
        layers: [
          { layer: 'high', precedence: 20, values: {} },
          { layer: 'low', precedence: 5, values: {} },
        ],
        schema,
      })
      expect.unreachable('an out-of-order chain was accepted')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('high')
      expect(message).toContain('low')
      expect(message).toMatch(/20/)
      expect(message).toMatch(/5/)
    }
  })

  it('test_a_chain_WITHOUT_precedence_numbers_is_ordered_by_position', () => {
    // Omitting `precedence` means "this array is already the order". Inventing zeros for those
    // entries would manufacture a conflict out of a legitimate usage.
    const positional = [
      { layer: 'first', values: { model: 'a' } },
      { layer: 'second', values: { model: 'b' } },
    ]
    expect(LayeredConfig.resolve({ layers: positional, schema }).value.model).toBe('b')
  })
})

describe('the schema is applied AFTER folding, not per layer', () => {
  it('test_a_partial_layer_is_legal_and_defaults_fill_the_rest', () => {
    // Validating each layer separately would force every file to be complete, which defeats
    // layering: a project override that sets one key would have to restate the whole config.
    const result = LayeredConfig.resolve({
      layers: [{ layer: 'only', values: { model: 'm' } }],
      schema,
    })
    expect(result.value).toEqual({ model: 'm', tools: [], timeout: 30 })
  })

  it('test_an_invalid_FOLDED_result_is_refused', () => {
    // And the counter-proof: folding does not mean skipping validation.
    expect(() =>
      LayeredConfig.resolve({ layers: [{ layer: 'bad', values: { model: 42 } }], schema }),
    ).toThrow()
  })
})
