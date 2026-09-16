/**
 * B-008 — the precedence of seven surfaces, asserted for the first time.
 *
 * Two nested ternaries decided which surface owns the input row — four branches in `InputSlot`,
 * four more in `ConversationSlot` — and no test file existed for either. B-007 measured why:
 * inside a ternary the question "which surface wins?" is only answerable by MOUNTING, and mounting
 * the alternatives drags in `@theocode/agent/config`, `/ask`, `/auth`, `@theocode/shared/agent`
 * and `node:os`. So the cost of asking was high enough that nobody asked.
 *
 * `selectSurface` makes selection pure, so these ask from a plain state object. Exactly ONE test
 * mounts (ADR D3), to prove the names are wired to real surfaces rather than to each other.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { selectSurface } from '@theokit/tui'

import { INPUT_LAYERS, type InputSlotProps } from '../../src/components/InputSlot.js'
import { CONVERSATION_LAYERS, type ConversationSlotProps } from '../../src/components/ConversationSlot.js'

/** The state where nothing but the composer is eligible — every test starts here and adds one fact. */
const settled = (over: Partial<InputSlotProps> = {}): InputSlotProps =>
  ({
    trusted: true,
    consent: { hooksReviewed: true, pendingHooks: [] },
    pendingHooks: [],
    pendingApproval: undefined,
    ...over,
  }) as unknown as InputSlotProps

const chatting = (over: Partial<ConversationSlotProps> = {}): ConversationSlotProps =>
  ({
    loginProvider: undefined,
    pendingQuestion: undefined,
    mode: 'chat',
    ...over,
  }) as unknown as ConversationSlotProps

const claimant = <S,>(layers: Parameters<typeof selectSurface<S>>[0], state: S): string | null =>
  selectSurface(layers, state).layer

describe('B-008 — which surface owns the input row', () => {
  // The pairs below were chosen by MEASURING which conditions can hold at once, not from the
  // item's phrasing. The pair its DoD suggests — hooks gate vs trust gate — is the one pair that
  // CANNOT overlap: the first requires `trusted`, the second `!trusted`. A test written from that
  // phrasing would assert an unreachable state and prove nothing.

  it('test_hooks_gate_wins_over_a_pending_approval', () => {
    expect(
      claimant(
        INPUT_LAYERS,
        settled({
          consent: { hooksReviewed: false, pendingHooks: ['x'] } as never,
          pendingHooks: ['x'] as never,
          pendingApproval: { approvalId: 'a' } as never,
        }),
      ),
    ).toBe('hooks-gate')
  })

  it('test_trust_gate_wins_over_a_pending_approval', () => {
    expect(
      claimant(
        INPUT_LAYERS,
        settled({ trusted: false, pendingApproval: { approvalId: 'a' } as never }),
      ),
    ).toBe('trust-gate')
  })

  it('test_the_approval_card_wins_over_the_conversation', () => {
    expect(claimant(INPUT_LAYERS, settled({ pendingApproval: { approvalId: 'a' } as never }))).toBe(
      'approval',
    )
  })

  it('test_the_conversation_claims_when_nothing_else_does', () => {
    expect(claimant(INPUT_LAYERS, settled())).toBe('conversation')
  })
})

describe('B-008 — which surface the conversation slot draws', () => {
  it('test_the_credential_field_wins_over_a_question_and_a_demo', () => {
    expect(
      claimant(
        CONVERSATION_LAYERS,
        chatting({ loginProvider: 'github', pendingQuestion: 'why?', mode: 'demo' as never }),
      ),
    ).toBe('credential')
  })

  it('test_the_question_wins_over_a_demo', () => {
    expect(
      claimant(CONVERSATION_LAYERS, chatting({ pendingQuestion: 'why?', mode: 'demo' as never })),
    ).toBe('question')
  })

  it('test_the_composer_claims_when_nothing_else_does', () => {
    expect(claimant(CONVERSATION_LAYERS, chatting())).toBe('composer')
  })

  it('test_every_state_has_a_claimant', () => {
    // The last layer of each list is unconditional, so `null` is unreachable today. Asserting it
    // means an edit that makes the fallback conditional fails HERE, loudly, instead of rendering
    // a blank row that looks like a hung terminal.
    const states: [Parameters<typeof selectSurface>[0], unknown][] = [
      [INPUT_LAYERS as never, settled()],
      [INPUT_LAYERS as never, settled({ trusted: false })],
      [CONVERSATION_LAYERS as never, chatting()],
      [CONVERSATION_LAYERS as never, chatting({ mode: 'demo' as never })],
    ]
    for (const [layers, state] of states) {
      expect(selectSurface(layers as never, state).layer).not.toBeNull()
    }
  })

  it('test_the_claimed_name_draws_that_surface', () => {
    // The one mounting test. Names that only agree with each other are a closed loop; this ties
    // one name to something a user would actually see.
    const state = settled({
      pendingApproval: {
        approvalId: 'a1',
        toolName: 'run_shell',
        input: { command: 'ls' },
      } as never,
    })
    const selected = selectSurface(INPUT_LAYERS, state)
    expect(selected.layer).toBe('approval')
    const { lastFrame } = render(<>{selected.render()}</>)
    // Measured, not guessed: the frame says `Run command` and `ls`, never the raw `run_shell` —
    // `formatApproval` turns the tool name into the sentence a human reads. The first draft of
    // this assertion looked for `run_shell` and failed, which is the whole reason one test mounts.
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Run command')
    expect(frame).toContain('ls')
  })
})
