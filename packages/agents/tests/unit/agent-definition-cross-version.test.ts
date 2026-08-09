/**
 * M79 DoD 4 — `AgentDefinition` is a PURE DATA CONTRACT, crossable between copies of the package.
 *
 * ## What this test protects, and why it exists
 *
 * For three majors agent-builder ran with TWO copies of `@theokit/agents` in the same process: the
 * authoring one on 4.x and the in-process transport on 0.44.x, because the published CLI pinned the
 * old line. They interoperated — and the reason they managed to is the only thing this file pins:
 *
 *   `AgentDefinition` is **data**, not an instance. Nobody does `instanceof` on it.
 *
 * If at some point the definition became a `class` (or the brand became a local `unique symbol`), the
 * two copies would stop recognizing each other — and the failure would be silent at the wrong point:
 * the object would arrive "almost right" at the transport and only break deep down, pointing at
 * nothing.
 *
 * ## M79 closed the skew — and that does NOT make the contract dispensable
 *
 * With the CLI published on the 4.x line there is **one** copy today. But the contract is what made
 * surviving the skew possible, and is what will make surviving the next one possible: any consumer
 * pinning a different range recreates the condition. An invariant tested only while it hurts is an
 * invariant nobody notices breaking in between.
 */
import { describe, expect, it } from 'vitest'

import { AGENT_BRAND, defineAgent, isAgentDefinition } from '../../src/bridge/define-agent.js'

describe('M79 — AgentDefinition crosses copies of the package', () => {
  it('test_the_brand_comes_from_the_GLOBAL_symbol_REGISTRY', () => {
    // `Symbol.for` resolves in the runtime's global registry — the SAME symbol identity across two
    // copies of the package loaded in the same process. A local `Symbol()` (or a `unique symbol`
    // without `for`) would give two distinct symbols, and each copy would reject the other's definition.
    expect(AGENT_BRAND).toBe(Symbol.for('theokit.agent.definition'))
  })

  it('test_a_definition_built_by_ANOTHER_copy_is_recognized', () => {
    // Simulates the other copy: a plain object stamped with the symbol from the global registry,
    // WITHOUT going through this copy's `defineAgent`. It is exactly what the in-process transport
    // used to receive.
    const fromAnotherCopy = {
      model: 'x',
      system: 'oi',
      [Symbol.for('theokit.agent.definition')]: true,
    }
    expect(
      isAgentDefinition(fromAnotherCopy),
      'a definition from another copy stopped being recognized — cross-version interop broke',
    ).toBe(true)
  })

  it('test_the_definition_is_NOT_a_class_instance', () => {
    // The central invariant. If this becomes a class, `instanceof` becomes tempting at the point of
    // use — and `instanceof` is exactly what does NOT cross two copies of the same package.
    const def = defineAgent({ model: 'x', system: 'oi' })
    expect(Object.getPrototypeOf(def)).toBe(Object.prototype)
  })

  it('test_COUNTERPROOF_an_object_WITHOUT_the_brand_is_rejected', () => {
    // Without this, `isAgentDefinition` could return `true` for anything and the tests above would
    // pass. The recognition has to be specific, not permissive.
    expect(isAgentDefinition({ model: 'x', system: 'oi' })).toBe(false)
    expect(isAgentDefinition({ [Symbol('theokit.agent.definition')]: true })).toBe(false)
  })
})
