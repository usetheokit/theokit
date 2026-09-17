/**
 * Where `memory:` starts parsing, asserted against whatever SDK is installed.
 *
 * ## What the first version of this file got wrong
 *
 * It asserted that the installed SDK parses the key — and `dep-check`'s floor run, which installs
 * the DECLARED floor, failed it with the very error the docblock quotes. The range is `^5.3.0` and
 * always was; nothing was lowered. The test was demanding a guarantee the range does not give,
 * which is the same defect it exists to document, written one layer up.
 *
 * So it pins the BOUNDARY instead. Both branches are real measurements, taken 2026-09-16 by
 * loading a subagent out of `.theokit/agents/` against the published tarballs:
 *
 *   < 5.9.0   ConfigurationError: Subagent note-taker.md: unknown frontmatter field "memory"
 *             (accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)
 *   >= 5.9.0  loads both fixtures; `memory: "project"` survives the parse
 *
 * Neither branch is a skip. On an old SDK the refusal is asserted, so this still fails if the SDK
 * ever starts silently DROPPING the key — which would be worse than refusing it, and is what the
 * issue behind this originally believed was happening.
 *
 * ## Why there is no runtime guard to test instead
 *
 * One was written and removed. Wiring a version check into `listSubagentNames` — the only place
 * this package touches that parse, and a root-barrel module — cost 161 bytes against 72 of
 * headroom. `agent-memory.ts` carries the attribution and the four measurements behind it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSubagents } from '@theokit/sdk/subagents-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** The first `@theokit/sdk` whose frontmatter parser accepts `memory:`. */
const PARSES_MEMORY_SINCE = { major: 5, minor: 9 } as const

const installed = (): { major: number; minor: number } => {
  const { version } = createRequire(import.meta.url)('@theokit/sdk/package.json') as {
    version: string
  }
  const [major, minor] = version.split('.').map((n) => Number.parseInt(n, 10))
  return { major: major ?? 0, minor: minor ?? 0 }
}

const parsesMemory = (): boolean => {
  const { major, minor } = installed()
  return (
    major > PARSES_MEMORY_SINCE.major ||
    (major === PARSES_MEMORY_SINCE.major && minor >= PARSES_MEMORY_SINCE.minor)
  )
}

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

describe('the boundary where a subagent memory: declaration starts parsing', () => {
  it('test_the_installed_sdk_behaves_as_its_version_says_it_should', async () => {
    if (!parsesMemory()) {
      // Asserted, not skipped. A silent DROP would pass a skip and is the worse failure — the
      // subagent would load with no memory and nothing would say why.
      await expect(discoverSubagents(root)).rejects.toThrow(/unknown frontmatter field/)
      return
    }

    const found = await discoverSubagents(root)
    const list = Array.isArray(found) ? found : Object.values(found ?? {})

    // The control. Zero means the probe is wrong, not that the SDK dropped anything — this probe
    // was wrong twice before it was right, in exactly that way.
    expect(list, 'both fixtures must be discovered, or this test measures nothing').toHaveLength(2)

    const defs = list.map((item) => (item as { definition?: unknown }).definition ?? item) as {
      memory?: unknown
    }[]
    const declared = defs.filter((d) => d.memory !== undefined)

    expect(declared, 'exactly one fixture declares memory:').toHaveLength(1)
    expect(declared[0]?.memory, 'the value the author wrote must survive').toBe('project')

    // The anti-vacuity floor: a loader inventing `memory` on everything would satisfy the line
    // above while making the declaration meaningless.
    expect(defs.filter((d) => d.memory === undefined)).toHaveLength(1)
  })
})
