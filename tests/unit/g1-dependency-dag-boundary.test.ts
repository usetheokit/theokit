/**
 * M32 / ADR-0044 D4 — the G1 dependency DAG is a TESTED invariant.
 *
 * `@theokit/http` MUST NOT statically import `@theokit/agents` (agents depends on http, never the
 * reverse — `rules/system-design-guardrails.md` G1). Authorizing TUI/MCP/Tauri as framework-core
 * surfaces (ADR-0044) makes a unit tempted to straddle both packages; this test guards the locked
 * direction so a straddling import cannot silently land. Composition of the HTTP shape + agent/tool
 * metadata happens at the `packages/theo` layer (which legally depends on both), never by http
 * reaching into agents.
 *
 * ALLOWED exception (documented): the guarded **dynamic** import of `@theokit/agents` as an OPTIONAL
 * peer in `packages/http/src/app.ts` (`importFn('@theokit/agents')`, hardcoded string, throws a
 * clear error when the peer is absent). A dynamic optional-peer bridge is not a static DAG edge
 * (dependency-cruiser treats it the same way) — this test asserts only the absence of STATIC
 * `import … from '@theokit/agents'` edges.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const HTTP_SRC = resolve(__dirname, '../../packages/http/src')

/**
 * Line-based, ReDoS-safe detector for a static `import … from '@theokit/agents(/…)'` — the hard DAG
 * edge G1 forbids. Ignores dynamic `import(...)`/`importFn(...)` (the documented optional-peer bridge)
 * because those are not `import … from` statements.
 */
function staticAgentsImports(src: string): string[] {
  const hits: string[] = []
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('import ') && !line.startsWith('import{')) continue
    if (!line.includes(' from ')) continue // side-effect or bare import — not a from-edge
    if (
      line.includes("'@theokit/agents'") ||
      line.includes('"@theokit/agents"') ||
      line.includes("'@theokit/agents/") ||
      line.includes('"@theokit/agents/')
    ) {
      hits.push(line)
    }
  }
  return hits
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

describe('G1 dependency DAG — @theokit/http ↛ @theokit/agents (ADR-0044 D4)', () => {
  it('packages/http/src has ZERO static imports from @theokit/agents', () => {
    const offenders: string[] = []
    for (const file of walk(HTTP_SRC)) {
      const hits = staticAgentsImports(readFileSync(file, 'utf8'))
      if (hits.length > 0) {
        offenders.push(`${file.replace(HTTP_SRC, 'packages/http/src')}: ${hits.join(' | ')}`)
      }
    }
    // If this fails: a static http→agents import violates the locked G1 direction. Compose at the
    // packages/theo layer instead, or use the documented dynamic optional-peer bridge.
    expect(offenders).toEqual([])
  })

  it('the documented dynamic optional-peer bridge still exists (guarded, not a static edge)', () => {
    const app = readFileSync(join(HTTP_SRC, 'app.ts'), 'utf8')
    // Sanity: the ONLY agents reference in http is the guarded dynamic import (ADR-0044 exception).
    expect(app).toMatch(/importFn\(\s*['"]@theokit\/agents['"]\s*\)/)
  })
})
