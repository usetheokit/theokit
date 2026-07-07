/**
 * M13 (theokit-ai-first) — per-request skills resolution.
 *
 * The `skills.enabled` filter already works (compile-skills maps `include` → SDK `enabled`). The
 * gap this closes: choosing the enabled skill set PER REQUEST (multi-tenant — different users see
 * different skills). `resolveEnabledSkills` accepts either a static list or a resolver function that
 * receives the request context (M7 run-context). Home/boundary concern (ADR-0040 § D2).
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { resolveEnabledSkills, type SkillsSelection } from '../../src/skills-resolver.js'

describe('resolveEnabledSkills', () => {
  it('returns a static list unchanged', async () => {
    expect(await resolveEnabledSkills(['a', 'b'], {})).toEqual(['a', 'b'])
  })

  it('calls a resolver with the request context and returns its list', async () => {
    const selection: SkillsSelection = (ctx) =>
      ctx.role === 'admin' ? ['admin-tools', 'search'] : ['search']

    expect(await resolveEnabledSkills(selection, { role: 'admin' })).toEqual(['admin-tools', 'search'])
    expect(await resolveEnabledSkills(selection, { role: 'guest' })).toEqual(['search'])
  })

  it('awaits an async resolver', async () => {
    const selection: SkillsSelection = async (ctx) => [`skill-for-${ctx.tenant as string}`]
    expect(await resolveEnabledSkills(selection, { tenant: 'acme' })).toEqual(['skill-for-acme'])
  })

  it('returns undefined for undefined selection (⇒ SDK enables every discovered skill)', async () => {
    expect(await resolveEnabledSkills(undefined, {})).toBeUndefined()
  })

  it('validates that a resolver returns an array (fails fast on a bad return)', async () => {
    // @ts-expect-error — intentionally wrong return type to exercise the runtime guard
    const bad: SkillsSelection = () => 'not-an-array'
    await expect(resolveEnabledSkills(bad, {})).rejects.toThrow(/array/i)
  })
})
