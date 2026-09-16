/**
 * B-067 — the footer never names an affordance this build does not wire.
 *
 * `StatusFooter` declares `hint = DEFAULT_HINT` as a DEFAULT PARAMETER, and its default is
 * `'? for shortcuts · ← for agents'`. So passing `undefined` to mean "say nothing" says the
 * opposite: it restores the hint that was being suppressed AND adds an agents panel this product
 * has never built (B-072 is that capability; it does not exist yet).
 *
 * That is the same defect B-028 closed for the `!` shell shortcut, arriving through a channel
 * B-028's filter cannot observe. That filter read the toolkit's SHORTCUT LIST and gated it by
 * capability; nothing filtered the toolkit's FOOTER HINT, and its docstring claimed a scope
 * ("the next unwired shortcut cannot be advertised either") that only ever covered the list.
 *
 * B-006 — both channels are now derived by `@theokit/tui` (`composerShortcutsFor` /
 * `footerHintFor`) from one declaration in `composer-capabilities.ts`. These tests did not move
 * and were not edited: they assert the rendered frame, so they are the migration's proof.
 *
 * These tests assert what the user READS, not what this app passes — so a hint supplied by the
 * toolkit's default, by a future toolkit version, or by us turns them red the same way.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { SessionFooter, type FooterProps } from '../../src/components/SessionFooter.js'

const ANSI = /\[[0-9;]*m/g

/**
 * Every affordance the toolkit's footer can advertise, mapped to whether THIS build wires it.
 * An entry flips to `true` in the same commit that wires the handler — never before.
 */
const AFFORDANCES: readonly { readonly text: string; readonly wired: boolean }[] = [
  // `?` toggles the shortcuts panel — wired, but only while shortcuts are actually available.
  { text: '? for shortcuts', wired: true },
  // `←` opens an agents panel. Not built: B-072 carries the capability.
  { text: '← for agents', wired: false },
]

function props(overrides: Partial<FooterProps> = {}): FooterProps {
  return {
    SESSION: {
      sessionModel: () => 'gpt-5.4',
      cfg: () => ({
        modelLabel: 'gpt-5.4',
        sandboxLabel: 'sandbox:workspace-write',
        contextWindow: { window: 200_000, source: 'catalogue' },
      }),
    },
    effort: 'medium',
    approvalMode: 'suggest',
    goalBadge: '',
    credentialSource: () => 'oauth (openai)',
    lastUsage: undefined,
    shortcutsAvailable: true,
    ...overrides,
  }
}

function frame(p: FooterProps): string {
  const instance = render(<SessionFooter {...p} />)
  const out = (instance.lastFrame() ?? '').replace(ANSI, '')
  instance.unmount()
  return out
}

describe('B-067 — the footer advertises only what this build wires', () => {
  it('test_footer_never_names_an_unwired_affordance', () => {
    // Both states matter: the defect was invisible with shortcuts available and appeared the
    // moment they were not, which is why a single-state test would have passed on it.
    for (const shortcutsAvailable of [true, false]) {
      const out = frame(props({ shortcutsAvailable }))
      for (const { text, wired } of AFFORDANCES.filter((a) => !a.wired)) {
        void wired
        expect(
          out,
          `the footer advertises "${text}" with shortcutsAvailable=${String(shortcutsAvailable)}, and nothing handles it`,
        ).not.toContain(text)
      }
    }
  })

  it('test_footer_suppresses_the_shortcuts_hint_when_shortcuts_are_unavailable', () => {
    // B-046's intent. It never held: `undefined` reached the toolkit's default, which put the
    // hint back. Asserting the intent directly is what makes the regression impossible to
    // reintroduce by passing `undefined` again.
    expect(frame(props({ shortcutsAvailable: false }))).not.toContain('? for shortcuts')
  })

  it('test_footer_shows_the_shortcuts_hint_when_shortcuts_are_available', () => {
    // The floor: suppressing everything would pass the two tests above and break the product.
    expect(frame(props({ shortcutsAvailable: true }))).toContain('? for shortcuts')
  })
})
