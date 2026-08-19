import { describe, it, expect } from 'vitest'
import { theoConfigSchema } from 'theokit'

/**
 * `ui.theme` accepts any theme @theokit/ui can resolve.
 *
 * It used to be a closed enum — `'violet-forge' | 'noir' | 'paper'` — and two of those three were
 * never real themes. The practical effect was that the only accepted value was the default: every
 * theme the design system actually ships, and everything built with `defineTheme()`, was rejected
 * by config validation.
 *
 * These tests exist so that enum cannot come back. The first one fails the moment someone narrows
 * the field to a fixed list again.
 */
describe('config: ui.theme', () => {
  const parseTheme = (theme: string) => theoConfigSchema.safeParse({ ui: { theme } })

  it('accepts every theme @theokit/ui ships', () => {
    const shipped = [
      'violet-forge',
      'falcon-red',
      'classic-paper',
      'aurora-terminal',
      'vercel-mono',
      'github-dark',
      'dracula',
      'one-dark',
      'anthropic-style',
      'openai-style',
      'linear-glass',
    ]

    for (const theme of shipped) {
      expect(parseTheme(theme).success, `theme "${theme}" should be accepted`).toBe(true)
    }
  })

  it('accepts a custom theme name from defineTheme()', () => {
    expect(parseTheme('acme-corp').success).toBe(true)
    expect(parseTheme('brand2').success).toBe(true)
  })

  it('rejects names @theokit/ui would refuse to render', () => {
    // The value reaches a CSS selector and an interpolated string in the generated entry, so a
    // name that is not a plain identifier is a code-injection vector, not just a typo.
    expect(parseTheme("violet' , evil: '").success).toBe(false)
    expect(parseTheme('has spaces').success).toBe(false)
    expect(parseTheme('9-leading-digit').success).toBe(false)
    expect(parseTheme('Upper-Case').success).toBe(false)
    expect(parseTheme('').success).toBe(false)
  })

  it('leaves ui.theme optional and keeps the opt-out', () => {
    expect(theoConfigSchema.safeParse({ ui: {} }).success).toBe(true)
    expect(theoConfigSchema.safeParse({ ui: false }).success).toBe(true)
    expect(theoConfigSchema.safeParse({}).success).toBe(true)
  })

  it('still rejects an unknown fonts value', () => {
    expect(theoConfigSchema.safeParse({ ui: { fonts: 'webfont' } }).success).toBe(false)
    expect(theoConfigSchema.safeParse({ ui: { fonts: 'cdn' } }).success).toBe(true)
  })
})
