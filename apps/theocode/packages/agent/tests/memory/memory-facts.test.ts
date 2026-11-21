/**
 * B-077 — reading and forgetting a fact, now through the SDK fact API.
 *
 * The store is a markdown file a human also edits: a fact the SDK cannot see cannot be listed or
 * removed, and one it removes wrongly takes a neighbour with it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listMemoryFacts, removeMemoryFact } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const STORE = `# Memory

## Facts

- prefers tabs
- deploys on Fridays
- uses pnpm

## Notes

- not a fact
`

let dir: string
const file = () => join(dir, '.theokit', 'memory', 'MEMORY.md')
const seed = (text: string) => {
  // Hand-seeded: SDK 5.32.0 has no public fact writer (theokit-sdk#1062).
  mkdirSync(join(dir, '.theokit', 'memory'), { recursive: true })
  writeFileSync(file(), text)
}
const texts = async () => (await listMemoryFacts(dir)).map((f) => f.text)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-facts-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('B-077 — memoryFacts', () => {
  it('test_reads_the_bullets_under_facts', async () => {
    seed(STORE)
    expect(await texts()).toEqual(['prefers tabs', 'deploys on Fridays', 'uses pnpm'])
  })

  it('test_stops_at_the_next_heading', async () => {
    // The floor: a store with other sections must not leak them in as facts.
    seed(STORE)
    expect(await texts()).not.toContain('not a fact')
  })

  it('test_a_store_without_a_facts_section_is_empty', async () => {
    seed('# Memory\n\nnothing here\n')
    expect(await texts()).toEqual([])
  })

  it('test_star_bullets_are_not_listed_by_the_sdk', async () => {
    // The old local parser read `* ` bullets; the SDK does not. Pinned so a change is noticed.
    seed('## Facts\n\n- a\n* b\n')
    expect(await texts()).toEqual(['a'])
  })
})

describe('B-077 — withFactRemoved', () => {
  it('test_removes_the_named_fact_and_keeps_the_rest', async () => {
    seed(STORE)
    const facts = await listMemoryFacts(dir)
    expect(await removeMemoryFact(dir, facts[1]!.id)).toBe(true)
    expect(await texts()).toEqual(['prefers tabs', 'uses pnpm'])
  })

  it('test_keeps_everything_outside_the_facts_section', async () => {
    // Removing a fact must not disturb the rest of the file — it is a document a human also edits.
    seed(STORE)
    const facts = await listMemoryFacts(dir)
    await removeMemoryFact(dir, facts[0]!.id)
    const out = readFileSync(file(), 'utf8')
    expect(out).toContain('## Notes')
    expect(out).toContain('- not a fact')
  })

  it('test_an_index_that_names_no_fact_returns_undefined', async () => {
    // So the caller says "there is no such fact" instead of reporting success on a no-op.
    seed(STORE)
    expect(await removeMemoryFact(dir, 'no-such-id')).toBe(false)
    expect(await texts()).toHaveLength(3)
  })

  it('test_removes_only_one_line_when_two_facts_are_identical', async () => {
    // Anti-vacuity: a filter written without a `removed` latch deletes both.
    seed('## Facts\n\n- same\n- same\n')
    const facts = await listMemoryFacts(dir)
    await removeMemoryFact(dir, facts[0]!.id)
    expect(await texts()).toEqual(['same'])
  })
})
