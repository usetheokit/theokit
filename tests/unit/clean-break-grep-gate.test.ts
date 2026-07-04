import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * M3 clean-break DoD gate (executable proof): the proprietary agent surface is
 * GONE from the packages' `src` trees. A scan for `AgentEvent` / `useAgentStream`
 * MUST return zero matches — comments included (the removal is total, no compat).
 *
 * The replacement is the M2 `agents/*.ts` convention (`defineAgent` → `useAgent`
 * over the ai-sdk UIMessageStream wire). Implemented as a Node file walk (not a
 * shell `grep`) so it is portable and needs no external binary.
 */
const ROOT = resolve(__dirname, '../..')
const SRC_DIRS = ['packages/theo/src', 'packages/agents/src', 'packages/create-theokit/src'].map(
  (d) => resolve(ROOT, d),
)

const SRC_EXT = /\.(ts|tsx|js|jsx|mts|cts)$/

/** Recursively collect source files under a dir. */
function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, acc)
    else if (entry.isFile() && SRC_EXT.test(entry.name)) acc.push(full)
  }
  return acc
}

/** Return `path:line: text` matches of `pattern` across all src files (empty = clean). */
function scanSrc(pattern: RegExp): string[] {
  const hits: string[] = []
  for (const dir of SRC_DIRS) {
    for (const file of collectFiles(dir)) {
      const lines = readFileSync(file, 'utf-8').split('\n')
      lines.forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`)
      })
    }
  }
  return hits
}

describe('M3 clean break — proprietary agent surface removed from src', () => {
  it('"AgentEvent" and "useAgentStream" are absent from packages src (DoD gate)', () => {
    const hits = scanSrc(/AgentEvent|useAgentStream/)
    expect(hits, `expected 0 matches, found:\n${hits.join('\n')}`).toEqual([])
  })

  it('the other removed proprietary symbols are also gone from src', () => {
    const hits = scanSrc(
      /defineAgentEndpoint|streamAgentRun|createConversationHistory|consumeAgentStream|useAgentToolCards|foldAgentToolCards/,
    )
    expect(hits, `expected 0 matches, found:\n${hits.join('\n')}`).toEqual([])
  })
})
