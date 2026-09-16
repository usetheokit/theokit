/**
 * Every surface the framework DECLARES is exercised here, against the package the registry served.
 *
 * ## Why this exists, in one measurement
 *
 * `@theokit/agents@14.5.0` shipped `applySubagentMemory` and nothing anywhere called it. Wiring it
 * into this product on 2026-09-16 ran the `user` scope for the first time and it THREW: the applier
 * built `{ home }` where the resolver reads `homeDir`. Six tests upstream covered that function and
 * all six declared `project`, so the one root that needs `home` had gone through it zero times. The
 * same day, `loadPersonalMcpServers` shipped with no caller either, and the entry-point gate reported
 * `32 of 32` green while the meta-package's 28 entry points had never run a single import.
 *
 * Three capabilities, one shape: **a reader and a declaration one call apart are not a capability.**
 * Only the join proves it, and until this file existed nothing in the ecosystem performed the join
 * for every surface at once. When it was first run it named TEN declared readers that nothing in
 * this product exercised — in a product whose stated purpose is to validate that framework.
 *
 * ## What makes it a guarantee rather than a habit
 *
 * The list is not written here. It is READ from the installed package's own README — the copy inside
 * the tarball, which is what a consumer gets — so a surface the framework starts promising appears in
 * this test's input without anyone remembering to add it. A row that promises a reader and has no
 * probe fails. A probe that throws fails.
 *
 * Every probe imports from `@theokit/agents`, never from source. That is not incidental: importing
 * `applySubagentMemory` from the root barrel TYPE-CHECKS — the bundled `.d.ts` declares it — and
 * throws at runtime with `does not provide an export named`, because it lives on the `./config`
 * subpath. A probe reading source would have passed while every consumer failed.
 *
 * ## What it deliberately does NOT assert
 *
 * That this product WIRES each surface into a live session. It does not, for some, and that is a
 * separate decision with its own reasoning — `~/.claude.json` is the clearest case, refused at the
 * session level by the precedent in `delegation/role-discovery.ts`. What this file proves is that the
 * framework's side works when called. Confusing the two would let a product decision read as a
 * broken framework, or a broken framework hide behind a product decision.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { discoverSubagents, loadMcpJson, loadPersonalMcpServers } from '@theokit/agents'
import {
  applySubagentMemory,
  loadInstructionTree,
  loadSettings,
  permissionRulesFromSettings,
  resolveOutputStyle,
} from '@theokit/agents/config'
import { afterAll, describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)
const PKG = dirname(require_.resolve('@theokit/agents/package.json'))

/**
 * The verdicts that PROMISE a reader, so a probe is owed.
 *
 * `out of scope` and `refused` are decisions with a reason and own no reader — requiring a probe for
 * them would ask this product to exercise a capability the framework says it does not have.
 * `resolvable` IS owed one: it means the reader exists and the host decides whether to call it, and
 * "the host never called it" is precisely how the three defects above shipped.
 */
const PROMISES_A_READER = ['read', 'translated', 'parsed', 'resolvable'] as const

/** A surface whose reader cannot be reached from a test, with the reason. Never a silent skip. */
const EXEMPT: Readonly<Record<string, string>> = {}

const made: string[] = []
function tmp(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `conformance-${label}-`))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function write(root: string, rel: string, body: string): void {
  const f = join(root, rel)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, body)
}

/**
 * The declared table, parsed out of the INSTALLED README.
 *
 * Scoped to the section rather than the file: the README holds more than one table, and the other
 * one's first column is an import path.
 */
function declaredSurfaces(): { name: string; verdict: string }[] {
  const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
  const i = readme.indexOf('## Foreign configuration surfaces')
  expect(i, 'the installed README carries no surfaces section').toBeGreaterThan(-1)
  const section = readme.slice(i).split('\n## ')[0]

  return section
    .split('\n')
    .filter((l) => l.startsWith('| `') && !l.startsWith('| ---'))
    .map((l) => {
      const cells = l.split('|')
      return {
        name: (cells[1] ?? '').trim(),
        verdict: (cells[2] ?? '').trim().replace(/^\*\*/, '').toLowerCase(),
      }
    })
}

/**
 * One probe per declared surface. The key matches the README row's first cell VERBATIM, so a row
 * renamed upstream surfaces here as an unprobed surface rather than as a probe silently covering
 * nothing — the failure mode a substring match would hide.
 *
 * Each one reads a value BACK. Calling the reader and discarding the result would prove the symbol
 * resolves, which is the weaker half: `applySubagentMemory` resolved fine and returned the wrong
 * root, and only reading the note back caught it.
 */
const PROBES: Readonly<Record<string, () => Promise<void> | void>> = {
  '`CLAUDE.md`': () => {
    const cwd = tmp('claude-md')
    write(cwd, 'CLAUDE.md', 'the canary in the instruction tree')
    const tree = loadInstructionTree({
      cwd,
      roots: [cwd],
      budget: { maxDepth: 2, maxFiles: 8, maxChars: 4096 },
      // The framework's own default list does NOT include CLAUDE.md; a host that wants it says so.
      // Passing it here is the claim the row makes — read WHEN THE HOST NAMES IT — exercised.
      fileNames: ['CLAUDE.md'],
    })
    expect(tree.blocks.map((b) => b.content).join('\n')).toContain(
      'the canary in the instruction tree',
    )
  },

  '`settings.json` — `permissions`': () => {
    const out = permissionRulesFromSettings({ allow: ['Bash(ls:*)'], deny: ['Bash(rm:*)'] })

    // TRANSLATED is the claim, so the raw string must NOT survive — asserting it would be asserting
    // the row's opposite. What the consumer receives is structure the SDK's engine evaluates, and
    // nothing here reconstructs it: the shape comes back from the framework or the probe fails.
    expect(JSON.stringify(out)).not.toContain('Bash(rm:*)')
    expect(out.rules.map((r) => r.action).sort()).toEqual(['allow', 'deny'])
    expect(new Set(out.rules.map((r) => r.tool))).toEqual(new Set(['Bash']))
    expect(out.unsupported, 'a plain allow/deny pair reported entries it could not carry').toEqual(
      [],
    )
  },

  '`settings.json` — `outputStyle`': () => {
    const cwd = tmp('output-style')
    write(cwd, '.claude/settings.json', JSON.stringify({ outputStyle: 'terse' }))
    expect(loadSettings({ cwd }).values.outputStyle).toBe('terse')
  },

  '`settings.json` — `env`': () => {
    const cwd = tmp('env')
    write(cwd, '.claude/settings.json', JSON.stringify({ env: { CANARY: 'parsed-not-applied' } }))

    // PARSED is the whole claim, and the row says so: the value comes back on the result and is
    // never put into `process.env`. Asserting both halves is what makes the row checkable — a
    // framework that quietly applied it would pass a test that only read the parsed value.
    expect(loadSettings({ cwd }).values.env?.CANARY).toBe('parsed-not-applied')
    expect(process.env.CANARY).toBeUndefined()
  },

  '`settings.local.json`': () => {
    const cwd = tmp('settings-local')
    write(cwd, '.claude/settings.json', JSON.stringify({ outputStyle: 'from-shared' }))
    write(cwd, '.claude/settings.local.json', JSON.stringify({ outputStyle: 'from-local' }))
    // "layered above" is the claim; equal precedence would return the shared value.
    expect(loadSettings({ cwd }).values.outputStyle).toBe('from-local')
  },

  '`skills/`, `agents/`, `commands/`, `plugins/`': async () => {
    const cwd = tmp('dialect')
    write(
      cwd,
      '.claude/agents/canary.md',
      '---\nname: canary\ndescription: a foreign definition\n---\nbody\n',
    )
    // "read when the dialect is DECLARED" — so the same call without `compatSources` must NOT see it.
    // Both directions, because a framework that read the foreign root unconditionally would pass the
    // positive half while breaking the grant the row describes.
    const withGrant = await discoverSubagents(cwd, {
      settingSources: ['project'],
      compatSources: [{ kind: 'claude-code' as const, import: ['subagents'] }],
    })
    const without = await discoverSubagents(cwd, { settingSources: ['project'] })

    expect(Object.keys(withGrant)).toContain('canary')
    expect(Object.keys(without)).not.toContain('canary')
  },

  '`.mcp.json`': () => {
    const cwd = tmp('mcp-project')
    write(
      cwd,
      '.mcp.json',
      JSON.stringify({ mcpServers: { canary: { command: 'echo', args: ['hi'] } } }),
    )
    expect(Object.keys(loadMcpJson(cwd))).toContain('canary')
  },

  '`output-styles/*.md`': () => {
    const cwd = tmp('styles')
    write(cwd, '.claude/settings.json', JSON.stringify({ outputStyle: 'canary' }))
    write(
      cwd,
      '.claude/output-styles/canary.md',
      '---\nname: canary\ndescription: a style\n---\nAnswer tersely.\n',
    )
    // The row says "read, SELECTED BY settings.json" — so the join is the claim, not the file.
    const style = resolveOutputStyle({ cwd })
    expect(style, 'settings named a style and nothing resolved it').toBeDefined()
    expect(JSON.stringify(style)).toContain('Answer tersely.')
  },

  '`agent-memory/`': () => {
    const cwd = tmp('memory-cwd')
    const home = tmp('memory-home')
    write(cwd, '.claude/agent-memory/keeper/MEMORY.md', 'the project note')
    write(cwd, '.claude/agent-memory-local/keeper/MEMORY.md', 'the uncommitted note')
    write(home, '.claude/agent-memory/keeper/MEMORY.md', 'the note that crosses projects')

    // All THREE roots, which is the lesson this file was written for. Six upstream tests covered
    // this function and all six declared `project`; the `user` root threw on every call for a full
    // release because nothing had ever run it.
    const def = { description: 'd', prompt: 'body' }
    expect(
      applySubagentMemory({ ...def, memory: 'project' }, 'keeper', cwd, home).prompt,
    ).toContain('the project note')
    expect(applySubagentMemory({ ...def, memory: 'local' }, 'keeper', cwd, home).prompt).toContain(
      'the uncommitted note',
    )
    expect(applySubagentMemory({ ...def, memory: 'user' }, 'keeper', cwd, home).prompt).toContain(
      'the note that crosses projects',
    )
    // The control that keeps the three above honest.
    expect(applySubagentMemory(def, 'keeper', cwd, home)).toEqual(def)
  },

  '`~/.claude.json` — personal-scope MCP servers': () => {
    const home = tmp('personal-mcp')
    write(
      home,
      '.claude.json',
      JSON.stringify({
        mcpServers: { canary: { command: 'echo', args: ['hi'] } },
        // The row's own claim: only `mcpServers` travels out of a file another program owns.
        oauthAccount: { emailAddress: 'someone@example.com' },
        tipsHistory: { 'some-tip': 3 },
      }),
    )
    const servers = loadPersonalMcpServers(home)

    expect(Object.keys(servers)).toEqual(['canary'])
    expect(JSON.stringify(servers)).not.toContain('someone@example.com')
  },
}

describe('every surface the framework declares is exercised against the published package', () => {
  it('reads the declared table from the installed package, not from this repository', () => {
    const rows = declaredSurfaces()

    expect(rows.length, 'no surface rows parsed out of the installed README').toBeGreaterThan(8)
    for (const r of rows) expect(r.verdict, `"${r.name}" declares no verdict`).not.toBe('')
  })

  it('owes a probe for every surface that promises a reader', () => {
    const owed = declaredSurfaces()
      .filter((r) => PROMISES_A_READER.some((v) => r.verdict.startsWith(v)))
      .map((r) => r.name)
      .filter((n) => PROBES[n] === undefined && EXEMPT[n] === undefined)

    expect(
      owed,
      `these surfaces promise a reader and nothing here exercises it:\n  ${owed.join('\n  ')}`,
    ).toEqual([])
  })

  it('has no probe for a surface the framework no longer declares', () => {
    const declared = new Set(declaredSurfaces().map((r) => r.name))
    const orphans = Object.keys(PROBES).filter((n) => !declared.has(n))

    // A probe outliving its row is the quiet half: it keeps passing, so the suite looks like it
    // covers a surface that no longer exists while the renamed one goes unprobed.
    expect(orphans, `probes for surfaces nobody declares:\n  ${orphans.join('\n  ')}`).toEqual([])
  })

  for (const [surface, probe] of Object.entries(PROBES)) {
    it(`exercises ${surface}`, async () => {
      await probe()
    })
  }
})
