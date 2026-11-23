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

import {
  resolveEnabledSkills,
  resolveSkillsSettings,
  type SkillsSelection,
} from '../../src/skills-resolver.js'

describe('resolveEnabledSkills', () => {
  it('returns a static list unchanged', async () => {
    expect(await resolveEnabledSkills(['a', 'b'], {})).toEqual(['a', 'b'])
  })

  it('calls a resolver with the request context and returns its list', async () => {
    const selection: SkillsSelection = (ctx) =>
      ctx.role === 'admin' ? ['admin-tools', 'search'] : ['search']

    expect(await resolveEnabledSkills(selection, { role: 'admin' })).toEqual([
      'admin-tools',
      'search',
    ])
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

describe('resolveSkillsSettings', () => {
  it('passes a settings object returned by a sync resolver through untouched', async () => {
    const settings = { bundledDirs: ['/a'], skillsDir: '/a', inline: [] }
    expect(await resolveSkillsSettings(() => settings, {})).toBe(settings)
  })

  it('awaits an async resolver returning settings and hands it the context', async () => {
    const selection: SkillsSelection = async (ctx) => ({ skillsDir: `/t/${ctx.tenant as string}` })
    expect(await resolveSkillsSettings(selection, { tenant: 'acme' })).toEqual({
      skillsDir: '/t/acme',
    })
  })

  it('turns a returned name list into enabled + autoInject', async () => {
    expect(await resolveSkillsSettings(() => ['a'], {})).toEqual({
      enabled: ['a'],
      autoInject: true,
    })
  })

  it('is undefined for a non-function selection', async () => {
    expect(await resolveSkillsSettings(undefined, {})).toBeUndefined()
    expect(await resolveSkillsSettings(['a'], {})).toBeUndefined()
  })

  it('still rejects a bad return (non-array, non-object, bad names)', async () => {
    await expect(resolveSkillsSettings((() => 'x') as never, {})).rejects.toThrow(/array/)
    await expect(resolveSkillsSettings((() => [42]) as never, {})).rejects.toThrow(/NAME/)
  })
})

describe('resolveEnabledSkills with a settings selection', () => {
  it('reads enabled from a static SkillsSettings', async () => {
    expect(await resolveEnabledSkills({ enabled: ['z'] }, {})).toEqual(['z'])
    expect(await resolveEnabledSkills({ skillsDir: '/a' }, {})).toBeUndefined()
  })
})
