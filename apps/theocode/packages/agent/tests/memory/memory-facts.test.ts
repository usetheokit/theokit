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

describe('B-077 — listMemoryFacts', () => {
  it('test_reads_the_bullets_under_facts_and_not_other_sections', async () => {
    seed(STORE)
    const got = await texts()
    expect(got).toEqual(['prefers tabs', 'deploys on Fridays', 'uses pnpm'])
    expect(got).not.toContain('not a fact')
  })

  it('test_a_store_without_a_facts_section_is_empty', async () => {
    seed('# Memory\n\nnothing here\n')
    expect(await texts()).toEqual([])
  })
})

describe('B-077 — removeMemoryFact', () => {
  it('test_removes_the_named_fact_and_keeps_the_rest_of_the_file', async () => {
    seed(STORE)
    const facts = await listMemoryFacts(dir)
    expect(await removeMemoryFact(dir, facts[1]!.id)).toBe(true)
    expect(await texts()).toEqual(['prefers tabs', 'uses pnpm'])
    expect(readFileSync(file(), 'utf8')).toContain('- not a fact')
  })

  it('test_an_unknown_id_returns_false', async () => {
    seed(STORE)
    expect(await removeMemoryFact(dir, 'no-such-id')).toBe(false)
    expect(await texts()).toHaveLength(3)
  })
})
