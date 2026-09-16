/**
 * `/statusline` changes what the RENDERED footer says, not what a module thinks it should say.
 *
 * The store is the easy half and would be green whatever the footer did with it. What this asserts
 * is the frame: a footer that read the selection once at import, or that subscribed and never
 * re-rendered, produces exactly the same store state and a footer that never changes — which is the
 * defect `theme-session.tsx` documents for the theme base and the reason both features are stores
 * with listeners rather than module constants.
 *
 * Every expectation is on text a user can read, stripped of colour, so a footer that stopped
 * rendering an item because of a layout change fails here the same way a broken selection would.
 */
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleStatusline } from '../../src/commands/surface-commands.js'
import { SessionFooter, type FooterProps } from '../../src/components/SessionFooter.js'
import { STATUSLINE_ITEMS, statuslineSelection } from '../../src/session-ui/statusline-session.js'

/**
 * The two answer channels, discarded.
 *
 * These cases assert what the SURFACE does, so the words are noise here — `surface-commands.test.ts`
 * is where the toast and the panel are read.
 */
const screen = () => ({ setToast: vi.fn(), setPanel: vi.fn() })

// The assertions below are about text a user READS, and SGR bytes sit between the words.
// eslint-disable-next-line no-control-regex -- matching the colour codes is the point here
const ANSI = /\u001b\[[0-9;]*m/g

/**
 * One value per item, each unmistakable in a frame.
 *
 * Chosen so no item's text is a substring of another's: `not.toContain('effort')` against a value
 * that also appears inside the model name would pass on a footer that still drew it.
 */
function props(overrides: Partial<FooterProps> = {}): FooterProps {
  return {
    SESSION: {
      sessionModel: () => 'gpt-5.6-terra',
      cfg: () => ({
        modelLabel: 'gpt-5.6-terra',
        sandboxLabel: 'sandbox:workspace-write',
        contextWindow: { window: 200_000, source: 'catalogue' },
      }),
    },
    effort: 'medium',
    approvalMode: 'suggest',
    goalBadge: 'goal:pursuing (4s)',
    credentialSource: () => 'oauth (openai)',
    lastUsage: { inputTokens: 12_345 },
    shortcutsAvailable: true,
    ...overrides,
  }
}

/** What each item puts on screen, as the assertions below look for it. */
const RENDERED: Readonly<Record<(typeof STATUSLINE_ITEMS)[number], string>> = {
  model: 'gpt-5.6-terra',
  effort: 'medium',
  approval: 'suggest',
  sandbox: 'sandbox:workspace-write',
  goal: 'goal:pursuing (4s)',
  auth: 'oauth (openai)',
  context: 'context',
}

function frame(p: FooterProps = props()): string {
  const instance = render(<SessionFooter {...p} />)
  const out = (instance.lastFrame() ?? '').replace(ANSI, '')
  instance.unmount()
  return out
}

afterEach(() => {
  statuslineSelection.reset()
})

describe('the footer draws the items the session selected', () => {
  it('test_the_default_footer_draws_every_item', () => {
    // The anchor. Without it "the item disappeared" below could be satisfied by a footer that never
    // drew the item at all, and the default has to stay what it was before this was configurable.
    const out = frame()

    for (const [item, text] of Object.entries(RENDERED)) {
      expect(out, `${item} is in the default selection and was not drawn`).toContain(text)
    }
  })

  it('test_selecting_two_items_removes_the_rest_from_the_frame', () => {
    statuslineSelection.select(['model', 'auth'])
    const out = frame()

    expect(out, 'a selected item vanished').toContain(RENDERED.model)
    expect(out, 'a selected item vanished').toContain(RENDERED.auth)
    expect(
      out,
      'a deselected item is still drawn — the footer ignored the selection',
    ).not.toContain(RENDERED.sandbox)
    expect(out).not.toContain(RENDERED.approval)
  })

  it('test_dropping_context_removes_the_right_hand_meter', () => {
    // `context` is the one item drawn on the other side of the footer, so it is the one a
    // left-hand-only implementation would silently keep.
    statuslineSelection.select(['model'])

    expect(frame(), 'the context meter survived being deselected').not.toContain('context')
  })

  it('test_the_statusline_command_is_what_changes_the_frame', () => {
    // End to end: the words a user types, through the handler, into the rendered footer. Every
    // case above could pass with `/statusline` refusing every argument.
    handleStatusline('approval', screen())

    const out = frame()
    expect(out, '/statusline never reached the footer').toContain(RENDERED.approval)
    expect(out).not.toContain(RENDERED.model)
  })

  it('test_default_puts_every_item_back', () => {
    // Without this a user who narrowed the footer has no way to widen it short of relaunching.
    handleStatusline('approval', screen())
    handleStatusline('default', screen())

    expect(frame(), '/statusline default did not restore the footer').toContain(RENDERED.model)
  })
})

describe('the run keeps the shape it had before it was configurable', () => {
  it('test_the_model_and_the_effort_stay_one_phrase', () => {
    // `separatorBefore`'s whole reason. Flattening every gap to ` · ` would read as a redesign of
    // the footer shipped under a feature that was only supposed to make items optional.
    expect(frame(), 'the model and effort were split by a middot').toContain('gpt-5.6-terra medium')
  })

  it('test_the_other_items_are_middot_joined', () => {
    expect(frame()).toContain('medium · suggest · sandbox:workspace-write')
  })

  it('test_an_absent_goal_leaves_no_dangling_separator', () => {
    // `goal` is in the default selection and empty in most sessions. An item that rendered as an
    // empty string rather than being dropped would put ` ·  · ` in front of the credential.
    expect(
      frame(props({ goalBadge: '' })),
      'an empty item left its separator behind',
    ).not.toContain('·  ·')
  })
})
