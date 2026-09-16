/**
 * The layer fold — the rule every setting in this product resolves through, and the one that had no
 * test of its own.
 *
 * Found by mutation while preparing B-097's consumer migration: `foldLayers` was reachable only
 * through `resolveConfig`, and none of the cases that reached it distinguished the fold's rules from
 * each other. Four mutations survived the whole config suite — including one that makes a project
 * file DISPLACE the user's hooks instead of adding to them, which is the difference between a
 * repository adding a hook and a repository removing yours. A hook is arbitrary command execution on
 * every tool call, so that one is not a style question.
 */
import { describe, expect, it } from 'vitest'

import { LAYERS, foldLayers } from '../../src/config/layers.js'

describe('foldLayers — later layers win', () => {
  it('test_a_later_layer_replaces_an_earlier_value', () => {
    const out = foldLayers([
      { layer: 'defaults', values: { model: 'small' } },
      { layer: 'user', values: { model: 'large' } },
    ])

    expect(out['model']).toBe('large')
  })

  it('test_undefined_does_not_overwrite_what_an_earlier_layer_set', () => {
    // A layer that does not mention a key must not erase it. "The user set nothing" and "the user
    // set nothing on purpose" are different, and only the first is common — every layer here is a
    // partial record where absence is the norm.
    const out = foldLayers([
      { layer: 'defaults', values: { model: 'small' } },
      { layer: 'user', values: { model: undefined } },
    ])

    expect(out['model']).toBe('small')
  })

  it('test_keys_only_one_layer_mentions_survive', () => {
    const out = foldLayers([
      { layer: 'defaults', values: { a: 1 } },
      { layer: 'user', values: { b: 2 } },
    ])

    expect(out).toEqual({ a: 1, b: 2 })
  })
})

describe('foldLayers — accumulating keys', () => {
  it('test_an_accumulating_key_concatenates_instead_of_replacing', () => {
    // The reason accumulation exists. With last-wins, a project file displaces the user's global
    // hooks rather than adding to them.
    const out = foldLayers(
      [
        { layer: 'user', values: { hooks: ['user-hook'] } },
        { layer: 'project', values: { hooks: ['project-hook'] } },
      ],
      ['hooks'],
    )

    expect(
      out['hooks'],
      'a repository silently removed the hooks the user declared globally',
    ).toEqual(['user-hook', 'project-hook'])
  })

  it('test_a_key_not_declared_accumulating_still_replaces', () => {
    // Anti-vacuity: if every array accumulated, the case above would pass while the rule was "arrays
    // always concatenate" — which is not it. Most list-valued settings DO replace, `skills` included.
    const out = foldLayers([
      { layer: 'user', values: { skills: ['a'] } },
      { layer: 'project', values: { skills: ['b'] } },
    ])

    expect(out['skills']).toEqual(['b'])
  })

  it('test_accumulation_does_not_leak_between_calls', () => {
    // The accumulator is per-fold. A shared one would make the second resolution inherit the first
    // one's hooks — the shape of bug that only appears once two sessions run in one process, which
    // is exactly how the TUI resolves config after a `cd`.
    const entries = [{ layer: 'user' as const, values: { hooks: ['h'] } }]

    expect(foldLayers(entries, ['hooks'])['hooks']).toEqual(['h'])
    expect(foldLayers(entries, ['hooks'])['hooks']).toEqual(['h'])
  })
})

describe('foldLayers — the declared order is enforced, not assumed', () => {
  it('test_entries_out_of_declared_order_are_refused', () => {
    // The fold trusts the array order; this check is what makes that trust safe. Without it, a
    // caller that assembled the layers in the wrong order would get a silently inverted precedence
    // — `user` beating `cli`, or `defaults` beating everything.
    expect(() =>
      foldLayers([
        { layer: 'project', values: {} },
        { layer: 'user', values: {} },
      ]),
    ).toThrow(/does not outrank/)
  })

  it('test_the_declared_chain_is_strictly_ascending', () => {
    const precedences = LAYERS.map((c) => c.precedence)

    expect(precedences).toEqual([...precedences].sort((a, b) => a - b))
    expect(new Set(precedences).size).toBe(precedences.length)
  })
})
