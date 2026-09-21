/**
 * Every worker stub must export what the generated entry imports.
 *
 * Four test files write a `server.mjs` stub and rewrite EVERY non-relative import in the
 * generated Cloudflare entry to point at it (`cloudflare-serves-the-document.test.ts:66`). So a
 * stub has to export the union of every symbol the generator emits, from every module — and
 * that list is hand-maintained in four places.
 *
 * B-190 recorded the duplication and proposed extracting a shared stub. Measuring the four
 * copies first said otherwise: they are 19, 23, 26 and 33 lines with four distinct hashes,
 * because their IMPLEMENTATIONS legitimately differ — one `withSecurityHeaders` applies headers
 * and another is identity; one `mountAgent` returns a fixed Response and another delegates to a
 * recorder. Extracting those would couple things that must differ, which `CLAUDE.md` names as
 * forcing DRY onto accidental similarity.
 *
 * What IS duplicated is the LIST. This test derives it from the generator instead, which is
 * B-190's third DoD bullet: the export list "was assembled one SyntaxError at a time once
 * already", and a hand-kept list fails that way again on the next symbol added.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/** Every named symbol the entry imports from a non-relative module — the set a stub must cover. */
function importedSymbols(entry: string): Set<string> {
  const names = new Set<string>()
  // Same shape the test harnesses rewrite on: a non-relative, non-`node:` specifier.
  const named = /import\s*\{([^}]*)\}\s*from\s*'(?!node:|\.)[^']*'/g
  for (const match of entry.matchAll(named)) {
    for (const raw of match[1].split(',')) {
      const name = raw
        .trim()
        .split(/\s+as\s+/u)[0]
        .trim()
      if (name) names.add(name)
    }
  }
  return names
}

/** What a stub file actually exports. */
function stubExports(file: string): Set<string> {
  const text = readFileSync(join('tests/unit', file), 'utf-8')
  const names = new Set<string>()
  for (const match of text.matchAll(/export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1])
  }
  return names
}

const STUB_FILES = [
  'cloudflare-serves-the-document.test.ts',
  'deployed-agent-is-served.test.ts',
  'deployed-plugins-reach-the-entry.test.ts',
  'adapter-security-headers.test.ts',
]

/**
 * Every shape the generator can emit. `ssrStreaming` was the only axis this guard varied until
 * B-185, and `agents` is exactly as conditional: with none, `deployedAgentsFragment` returns its
 * EMPTY fragment and the agent import line is absent from the union, so a symbol added to that line
 * was invisible here. It cost 22 failing tests across three files in one run — the very failure
 * mode B-190 built this guard to prevent, arriving through the axis the guard did not turn.
 */
const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]
const SHAPES = [
  { ssrStreaming: false },
  { ssrStreaming: true },
  { ssrStreaming: false, agents: AGENTS },
  { ssrStreaming: true, agents: AGENTS },
] as const

function requiredSymbols(): Set<string> {
  const names = new Set<string>()
  for (const shape of SHAPES)
    for (const s of importedSymbols(renderCloudflareWorkerEntry(shape))) names.add(s)
  return names
}

describe('the worker stubs cover what the generator imports (B-190)', () => {
  it('test_the_symbol_list_is_derivable_from_the_generator', () => {
    // The list is CONDITIONAL — both `ssrStreaming` and `agents` change which modules are
    // imported — so the union over every shape is what a stub has to satisfy, not any one alone.
    const off = importedSymbols(renderCloudflareWorkerEntry({ ssrStreaming: false }))
    const on = importedSymbols(renderCloudflareWorkerEntry({ ssrStreaming: true }))
    const withAgents = importedSymbols(
      renderCloudflareWorkerEntry({ ssrStreaming: false, agents: AGENTS }),
    )

    expect(
      off.size,
      'the generator emitted no named non-relative imports — the extractor is wrong, not the generator',
    ).toBeGreaterThan(5)
    expect(
      [...on].some((s) => !off.has(s)),
      'ssrStreaming: true imported nothing extra, so this test is not covering the conditional arm it claims to',
    ).toBe(true)
    expect(
      [...withAgents].some((s) => !off.has(s)),
      'an entry WITH agents imported nothing extra, so this test is not covering the agents arm — ' +
        'which is the arm that was missing when a symbol added to it broke 22 tests',
    ).toBe(true)
  })

  it.each(STUB_FILES)('test_%s_exports_every_symbol_the_entry_imports', (file) => {
    const required = requiredSymbols()
    const exported = stubExports(file)

    const missing = [...required].filter((s) => !exported.has(s))
    expect(
      missing,
      `${file} would fail to resolve these at import time — one SyntaxError per run until each ` +
        `is added by hand, which is the failure mode B-190 records`,
    ).toEqual([])
  })
})
