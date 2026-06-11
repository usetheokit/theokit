/**
 * T3.2 — 0.3.0 release blog post exists and honors CLAUDE.md Voice & Tone.
 *
 * Per CLAUDE.md, blog posts live in the BODY layer (benefit-first; one
 * technical anchor per item) but transition to DEEP DIVE in technical
 * sections. The HERO (h1 + sub-h1) MUST answer "what do I get" — never
 * "what is it" or list internals.
 *
 * Banned in HERO/BODY: defineRoute, defineAction, defineWebSocket,
 * theoFetch, requireAuth, createSessionManager, defineMiddleware,
 * defineConfig, hydrateRoot, renderToPipeableStream, AES-256-GCM,
 * Drizzle ORM, opinionated, monorepo. Vite/Vitest/tsup are allowed in
 * DEEP DIVE only.
 *
 * Banned everywhere: blazing fast, robust, powerful, seamless,
 * enterprise-grade, next-generation, industry-leading, battle-tested
 * (unless followed by an actual battle), production-ready (without
 * Status backing).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const BLOG = resolve(__dirname, '../../docs/blog/0.3.0-release.md')

const BANNED_EVERYWHERE = [
  'blazing fast',
  'robust',
  'powerful',
  'seamless',
  'enterprise-grade',
  'next-generation',
  'industry-leading',
  'battle-tested',
] as const

describe('T3.2 — 0.3.0 release blog post exists and honors Voice & Tone', () => {
  it('blog file exists at the expected path', () => {
    expect(existsSync(BLOG)).toBe(true)
  })

  const content = existsSync(BLOG) ? readFileSync(BLOG, 'utf-8') : ''

  it('has an H1 (HERO) within the first 5 non-empty lines', () => {
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.slice(0, 5).some((l) => l.startsWith('# '))).toBe(true)
  })

  it('contains a Rollback section linking the migration guide', () => {
    expect(content).toMatch(/Rollback|opt-out/i)
    expect(content).toMatch(/0\.2-to-0\.3/)
  })

  it('cross-links ADR-0023 (in-house aligned with peers)', () => {
    expect(content).toMatch(/0023-csp-csrf-in-house-aligned-with-peers|ADR-0023/)
  })

  it('positions vs the 4 peer frameworks (Next.js, SvelteKit, Astro, Remix)', () => {
    expect(content).toMatch(/Next\.js/)
    expect(content).toMatch(/SvelteKit/)
    expect(content).toMatch(/Astro/)
    expect(content).toMatch(/Remix/)
  })

  it('mentions CsrfReadinessTab as the warn-mode telemetry differentiator (R1)', () => {
    expect(content).toMatch(/CsrfReadinessTab|warn.?mode telemetry/i)
  })

  it('does NOT use any term banned everywhere in CLAUDE.md', () => {
    for (const term of BANNED_EVERYWHERE) {
      expect(
        content.toLowerCase().includes(term.toLowerCase()),
        `Banned-everywhere term "${term}" found in blog post`,
      ).toBe(false)
    }
  })
})
