/**
 * `refuseForeignHook` cannot be consulted, and this pins the reason so nobody has to rediscover it.
 *
 * ## The gap this closes
 *
 * The gate's own tests prove what it ANSWERS — `false`, on every request, from any file. None of
 * them asks whether a request can arrive at all. It cannot: the framework only spawns hooks from a
 * foreign root when `hooks` is among the surfaces this product grants, and it is not.
 *
 * That leaves a predicate whose arms are all dark. An approval path built on top of it could not be
 * observed running — which is the entry condition the issue behind this test set out, in those
 * words, before any approval logic is written.
 *
 * ## What this test is NOT saying
 *
 * It is not saying the gate should be deleted. `hooks` is withheld deliberately: `.claude/` is
 * repository-controlled, it usually arrived with the clone, and a hook there is arbitrary shell. The
 * gate is the answer already prepared for the day that decision changes, and keeping a prepared
 * answer costs one function.
 *
 * What it is saying is that the day it changes, three things become true at once and only one of
 * them is code: the framework starts spawning those hooks, this predicate starts being asked, and a
 * user starts being asked to trust something they were never shown. The third is the real work, and
 * it is a product decision rather than a wiring one — so the test fails LOUDLY on the grant rather
 * than quietly approving a widened surface.
 */
import { describe, expect, it } from 'vitest'

import { FOREIGN_SURFACES } from '../../src/setting-sources.js'

describe('the foreign-hook gate has no path to reach it', () => {
  it('test_hooks_is_not_a_granted_foreign_surface', () => {
    // The fact the whole gate rests on. Measured rather than assumed: the list is the thing the
    // framework reads, so it is the thing to assert against.
    expect(
      [...FOREIGN_SURFACES],
      'granting `hooks` makes `refuseForeignHook` reachable AND makes the consent screen a ' +
        'requirement, not a follow-up — see the comment above before changing this',
    ).not.toContain('hooks')
  })

  it('test_the_surfaces_that_are_granted_are_the_ones_named', () => {
    // The anti-vacuity floor. An empty list would satisfy the assertion above while meaning the
    // product imports nothing at all, which is a different product.
    expect([...FOREIGN_SURFACES].sort()).toEqual([
      'commands',
      'context',
      'plugins',
      'skills',
      'subagents',
    ])
  })
})
