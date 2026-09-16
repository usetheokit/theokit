/**
 * B-077 — reading and forgetting a fact.
 *
 * The store is a markdown file, so the parser IS the contract: a fact it cannot see cannot be
 * listed or removed, and one it removes wrongly takes a neighbour with it.
 */
import { describe, expect, it } from 'vitest'

import { memoryFacts, withFactRemoved } from '../../src/memory/memory-facts.js'

const STORE = `# Memory

## Facts

- prefers tabs
- deploys on Fridays
* uses pnpm

## Notes

- not a fact
`

describe('B-077 — memoryFacts', () => {
  it('test_reads_the_bullets_under_facts', () => {
    expect(memoryFacts(STORE)).toEqual(['prefers tabs', 'deploys on Fridays', 'uses pnpm'])
  })

  it('test_stops_at_the_next_heading', () => {
    // The floor: a store with other sections must not leak them in as facts.
    expect(memoryFacts(STORE)).not.toContain('not a fact')
  })

  it('test_a_store_without_a_facts_section_is_empty', () => {
    expect(memoryFacts('# Memory\n\nnothing here\n')).toEqual([])
  })
})

describe('B-077 — withFactRemoved', () => {
  it('test_removes_the_named_fact_and_keeps_the_rest', () => {
    const out = withFactRemoved(STORE, 2)
    expect(out).toBeDefined()
    expect(memoryFacts(out ?? '')).toEqual(['prefers tabs', 'uses pnpm'])
  })

  it('test_keeps_everything_outside_the_facts_section', () => {
    // Removing a fact must not disturb the rest of the file — it is a document a human also edits.
    const out = withFactRemoved(STORE, 1) ?? ''
    expect(out).toContain('## Notes')
    expect(out).toContain('- not a fact')
  })

  it('test_an_index_that_names_no_fact_returns_undefined', () => {
    // So the caller says "there is no fact 7" instead of writing the file back unchanged and
    // reporting success — the silent no-op `rules/error-handling.md` forbids.
    expect(withFactRemoved(STORE, 7)).toBeUndefined()
    expect(withFactRemoved(STORE, 0)).toBeUndefined()
  })

  it('test_removes_only_one_line_when_two_facts_are_identical', () => {
    // Anti-vacuity: a filter written without the `removed` latch deletes both.
    const dup = '## Facts\n\n- same\n- same\n'
    expect(memoryFacts(withFactRemoved(dup, 1) ?? '')).toEqual(['same'])
  })
})
