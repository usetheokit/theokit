/**
 * The installed `@theokit/sdk` parses a subagent's `memory:` declaration.
 *
 * Pins the fact `agent-memory.ts` documents, so the docblock cannot rot into a claim nobody
 * re-checks. Measured 2026-09-16: refused at 5.3.0, parsed at 5.9.0 — and `dep-check`'s floor run
 * installs the declared floor and runs the suite, so this is where a lowered range would be caught.
 *
 * There is deliberately no runtime guard behind this. One was written and removed: wiring a version
 * check into `listSubagentNames` cost 161 bytes of the ROOT BARREL against 72 of headroom, and the
 * cost was the coupling rather than the code. `agent-memory.ts` carries the attribution.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSubagents } from '@theokit/sdk/subagents-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sdk-parses-memory-'))
  mkdirSync(join(root, '.theokit', 'agents'), { recursive: true })
  const write = (name: string, frontmatter: string): void =>
    writeFileSync(
      join(root, '.theokit', 'agents', `${name}.md`),
      `---\n${frontmatter}\n---\nBody.\n`,
    )
  write('note-taker', 'name: note-taker\ndescription: keeps durable notes\nmemory: project')
  write('plain', 'name: plain\ndescription: declares no memory at all')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const definitions = async (): Promise<{ memory?: unknown }[]> => {
  const found = await discoverSubagents(root)
  const list = Array.isArray(found) ? found : Object.values(found ?? {})
  return list.map((item) => (item as { definition?: unknown }).definition ?? item) as {
    memory?: unknown
  }[]
}

describe('the installed SDK parses a subagent memory: declaration', () => {
  it('test_the_declared_value_survives_the_parse', async () => {
    const defs = await definitions()

    // The control first. Zero here means the probe is wrong, not that the SDK dropped anything —
    // and this probe was wrong twice before it was right, in exactly that way.
    expect(defs, 'both fixtures must be discovered, or this test measures nothing').toHaveLength(2)

    const declared = defs.filter((d) => d.memory !== undefined)
    expect(declared, 'exactly one fixture declares memory:').toHaveLength(1)
    expect(declared[0]?.memory, 'the value the author wrote must survive').toBe('project')
  })

  it('test_a_subagent_declaring_no_memory_is_unaffected', async () => {
    // The anti-vacuity floor: a loader inventing `memory` on everything would satisfy the
    // assertion above while making the declaration meaningless.
    expect((await definitions()).filter((d) => d.memory === undefined)).toHaveLength(1)
  })
})
