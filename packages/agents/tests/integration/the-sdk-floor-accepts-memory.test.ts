/**
 * The declared `@theokit/sdk` floor must be a version that ACCEPTS `memory:` in subagent
 * frontmatter.
 *
 * ## Why this is a test and not a comment on the range
 *
 * `applySubagentMemory` shipped in 14.5.0 reading `AgentDefinition.memory`, a field the SDK is
 * responsible for carrying off the frontmatter. The package went on declaring `^5.3.0`, and the
 * field does not exist there — so the whole feature rested on whichever SDK a consumer happened to
 * resolve, with nothing anywhere saying so.
 *
 * Measured on 2026-09-16 against the published tarballs, with a control (a second subagent
 * declaring no `memory:` at all, which must load on both):
 *
 *   5.3.0  ConfigurationError: Subagent note-taker.md: unknown frontmatter field "memory"
 *          (accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)
 *   5.9.0  loads both; `memory: "project"` survives on the one that declares it
 *
 * The issue this closes described the failure as the function silently doing nothing. It is worse
 * than that: at the declared floor the subagent does not load AT ALL, and the error names a field
 * the author wrote on purpose. A reader would reasonably conclude the frontmatter is wrong.
 *
 * ## What makes this test the gate rather than the range
 *
 * It exercises the BEHAVIOUR against whatever SDK is installed. A pinned version string would pass
 * while the range said one thing and the resolution did another; `dep-check`'s floor run installs
 * the declared floor and runs the suite, so lowering the range makes this test fail there — which
 * is the only place the question is actually asked.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSubagents } from '@theokit/sdk/subagents-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let root: string

const write = (name: string, frontmatter: string): void => {
  writeFileSync(join(root, '.theokit', 'agents', `${name}.md`), `---\n${frontmatter}\n---\nBody.\n`)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sdk-floor-memory-'))
  mkdirSync(join(root, '.theokit', 'agents'), { recursive: true })
  write('note-taker', 'name: note-taker\ndescription: keeps durable notes\nmemory: project')
  write('plain', 'name: plain\ndescription: declares no memory at all')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the declared SDK floor carries a subagent memory: declaration', () => {
  it('test_a_subagent_declaring_memory_loads_and_keeps_the_field', async () => {
    const found = await discoverSubagents(root)
    const list = Array.isArray(found) ? found : Object.values(found ?? {})

    // The control first. Zero here means the probe is wrong, not that the SDK dropped anything —
    // an empty result is a statement about the query until something proves otherwise.
    expect(
      list,
      'both fixtures must be discovered, or this test is measuring nothing',
    ).toHaveLength(2)

    const defs = list.map((item) => (item as { definition?: unknown }).definition ?? item) as {
      memory?: unknown
    }[]
    const declared = defs.filter((d) => d.memory !== undefined)

    expect(declared, 'exactly one fixture declares memory:').toHaveLength(1)
    expect(declared[0]?.memory, 'the value the author wrote must survive the parse').toBe('project')
  })

  it('test_a_subagent_declaring_no_memory_is_unaffected', async () => {
    // The anti-vacuity floor. A loader that invented `memory` on everything would satisfy the
    // assertion above while making the declaration meaningless.
    const found = await discoverSubagents(root)
    const list = Array.isArray(found) ? found : Object.values(found ?? {})
    const defs = list.map((item) => (item as { definition?: unknown }).definition ?? item) as {
      memory?: unknown
    }[]

    expect(defs.filter((d) => d.memory === undefined)).toHaveLength(1)
  })
})
