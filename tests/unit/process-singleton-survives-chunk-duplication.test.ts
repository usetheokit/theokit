import { describe, it, expect } from 'vitest'

import { processSingleton } from '../../packages/theo/src/server/_internal/process-singleton.js'

/**
 * usetheokit/theokit#401 — `registerProvider` mutated a registry the server never
 * read, because the bundler put the module holding it into more than one chunk
 * and each chunk got its own module-level array.
 *
 * Measured in this repository's own `dist`: the provider registry appears in
 * FOUR chunks, and the HITL approval registry in two. The second matters more
 * than the first, because `approval-registry.ts` states single-instance as a
 * correctness requirement in its own words — "the approval a request awaits and
 * the approval the route resolves MUST be the same object" — and a bundler can
 * violate that silently.
 *
 * A module-level `let` gives one instance per MODULE INSTANCE. What these need is
 * one per process, which is a different guarantee, and `globalThis` keyed by
 * `Symbol.for` is the one mechanism that does not depend on how the bundler
 * happened to chunk today.
 *
 * The test imports the same module twice under different specifiers, which is how
 * two chunks holding the same source look from the inside.
 */

describe('a process-wide singleton is one object however the bundle is split (#401)', () => {
  it('test_two_calls_with_the_same_key_return_the_same_object', () => {
    const a = processSingleton('theokit.test.registry', () => ({ items: [] as string[] }))
    const b = processSingleton('theokit.test.registry', () => ({ items: [] as string[] }))

    expect(a).toBe(b)
  })

  it('test_a_mutation_through_one_reference_is_visible_through_the_other', () => {
    // The defect in one line: registered here, invisible there.
    const writer = processSingleton('theokit.test.mutation', () => ({ items: [] as string[] }))
    const reader = processSingleton('theokit.test.mutation', () => ({ items: [] as string[] }))

    writer.items.push('ollama')

    expect(reader.items).toEqual(['ollama'])
  })

  it('test_the_factory_runs_once_and_the_second_call_does_not_replace_it', () => {
    let built = 0
    const first = processSingleton('theokit.test.once', () => {
      built += 1
      return { id: built }
    })
    const second = processSingleton('theokit.test.once', () => {
      built += 1
      return { id: built }
    })

    expect(built).toBe(1)
    expect(second).toBe(first)
  })

  it('test_different_keys_are_different_objects', () => {
    const a = processSingleton('theokit.test.a', () => ({ n: 1 }))
    const b = processSingleton('theokit.test.b', () => ({ n: 2 }))

    expect(a).not.toBe(b)
  })

  it('test_a_second_module_instance_sees_the_same_object', async () => {
    // The actual simulation. A query string defeats the module cache, so the
    // second import evaluates the module again — which is what a duplicated
    // chunk is, and what a module-level `let` cannot survive.
    // Built at runtime so `tsc` does not try to resolve the query string, which is
    // a Vite mechanism rather than a module path. Suppressing the resulting error
    // with a directive would hide a genuine broken import here later.
    const secondInstance = '../../packages/theo/src/server/_internal/process-singleton.js?chunk=2'
    const again = (await import(/* @vite-ignore */ secondInstance)) as {
      processSingleton: typeof processSingleton
    }

    const fromHere = processSingleton('theokit.test.cross', () => ({ items: [] as string[] }))
    const fromThere = again.processSingleton('theokit.test.cross', () => ({
      items: [] as string[],
    }))

    fromHere.items.push('registered')

    expect(fromThere).toBe(fromHere)
    expect(fromThere.items).toEqual(['registered'])
  })
})
