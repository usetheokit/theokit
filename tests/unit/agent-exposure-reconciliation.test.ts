import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * M47 (ADR-M47-3) — reconciliation gate: `@Expose`, the `@Agent` class decorator, and the file convention
 * are three AUTHORING surfaces over ONE runtime (`mountAgent`). This test proves there is NO parallel agent
 * runtime — no second code path that streams a `UIMessageStream` for an agent besides `mountAgent`. If a
 * future change adds a parallel streamer, this gate fails, catching the exact "two competing paths" problem
 * the roadmap warned against.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

function srcFiles(pkgGlob: string): string[] {
  return globSync(`${REPO}/packages/${pkgGlob}/src/**/*.ts`, {}).filter(
    (f) => !f.includes('.test.') && !f.includes('mount-agent.ts'),
  )
}

describe('M47 — agent exposure reconciliation (one runtime, not a third path)', () => {
  it('test_http_package_where_expose_lives_introduces_no_agent_streamer', () => {
    // @Expose lives in @theokit/http. http MUST stay agent-runtime agnostic (G1/G2): it delegates to the
    // injected serveAgent, never building an agent UIMessageStream itself. So NO http source calls the
    // agent stream builder — proving M47 added an authoring surface, not a parallel runtime.
    const offenders: string[] = []
    for (const file of srcFiles('http')) {
      const text = readFileSync(file, 'utf-8')
      if (
        /\buiMessageStreamResponse\s*\(/.test(text) ||
        /\bstreamAgentUIMessages\s*\(/.test(text) ||
        /\bmountAgent\s*\(/.test(text)
      ) {
        offenders.push(file.replace(REPO + '/', ''))
      }
    }
    expect(offenders).toEqual([])
  })

  it('test_expose_and_agent_both_route_through_mount_agent', () => {
    // @Expose's serveAgent closure calls mountAgent; the @Agent/convention path calls mountAgent too.
    const apiMiddleware = readFileSync(
      resolve(REPO, 'packages/theo/src/vite-plugin/api-middleware.ts'),
      'utf-8',
    )
    const agentMiddleware = readFileSync(
      resolve(REPO, 'packages/theo/src/vite-plugin/agent-middleware.ts'),
      'utf-8',
    )
    // @Expose path (serveAgent) → mountAgent
    expect(apiMiddleware).toMatch(/serveAgent[\s\S]*mountAgent\(/)
    // convention/@Agent path → mountAgent
    expect(agentMiddleware).toMatch(/mountAgent\(/)
  })
})
