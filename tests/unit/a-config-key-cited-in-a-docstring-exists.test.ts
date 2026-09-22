import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'

/**
 * B-201. `track-agent-run.ts:17` carried `/** Adapter resolved from `theo.config.ts > cost.storage`. *\/`
 * and no `cost` key has ever existed in the schema — measured against a control of `observability`,
 * which returns 3. The item read that as a missing capability; it is not. `theokit/server/cost` is a
 * published subpath and `trackAgentRun` reaches the built `.d.ts` through it, so an app supplies its
 * adapter through `opts.storage`, which is what `@theokit/agents/usage`'s own contract decides:
 * "the framework owns the vocabulary; the app owns the storage".
 *
 * So what was broken is one sentence on a published surface, pointing a reader at configuration
 * that does not and should not exist. This repository hard-caps a plan for a citation that does not
 * resolve (`check_evidence_citations.py`); nothing asked the same of the source, and this is that
 * question. Measured when written: 14 citations, 7 distinct keys, 6 resolving.
 */
const CITATION = /theo\.config\.ts\s*>\s*([a-zA-Z]\w*)/g

function declaredTopLevelKeys(): Set<string> {
  // Read from the schema OBJECT rather than its source text: a regex over the file would pass on a
  // key that is commented out, which is the failure mode this test exists to catch one level down.
  const shape = (theoConfigSchema as unknown as { shape?: Record<string, unknown> }).shape
  if (shape === undefined) throw new Error('theoConfigSchema exposes no shape to introspect')
  return new Set(Object.keys(shape))
}

describe('a config key cited in a docstring exists in the schema', () => {
  it('test_every_theo_config_citation_in_source_resolves_to_a_schema_key', () => {
    // `node:fs` rather than a glob dependency: the stdlib has this since Node 22, and every other
    // test in this directory reaches for `node:fs` first.
    const files = globSync(['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'], {
      cwd: process.cwd(),
    }).filter((f) => !/\.test\.tsx?$/.test(f))
    const declared = declaredTopLevelKeys()
    const unresolved: string[] = []
    let citations = 0

    for (const rel of files) {
      const lines = readFileSync(join(process.cwd(), rel), 'utf8').split('\n')
      lines.forEach((line, index) => {
        for (const m of line.matchAll(CITATION)) {
          citations += 1
          if (!declared.has(m[1])) unresolved.push(`${rel}:${index + 1} cites \`${m[1]}\``)
        }
      })
    }

    // Printed even when green: a citation count that silently fell to zero would make this test
    // pass by measuring nothing, which is the shape it is written against.
    expect(citations, 'no `theo.config.ts > key` citation was found at all').toBeGreaterThan(5)
    expect(
      unresolved,
      `citations naming a key the schema does not declare:\n${unresolved.join('\n')}`,
    ).toEqual([])
  })
})
