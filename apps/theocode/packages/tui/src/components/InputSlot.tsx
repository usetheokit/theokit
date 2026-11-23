import type { Dispatch, ReactElement, SetStateAction } from 'react'

import {
  PermissionPrompt,
  narrowingLayer,
  selectSurface,
  type PendingApproval,
  type SurfaceLayer,
} from '@theokit/tui'

import { formatApproval } from '../formatting/index.js'
import type { ApprovalMode } from '../consent/index.js'
import type { ReasoningEffort } from '@theocode/agent/config'
import type { Mode, ToastPayload } from '../screen-types.js'
import { TrustGate, HooksGate } from './ConsentGates.js'
import { ConversationSlot } from './ConversationSlot.js'

export interface InputSlotProps {
  readonly trusted: boolean
  readonly consent: SlotConsent
  readonly pendingHooks: SlotConsent['pendingHooks']
  readonly pendingApproval: PendingApproval | undefined
  readonly pendingQuestion: string | undefined
  readonly loginProvider: string | undefined
  readonly mode: Mode
  readonly elapsed: number
  readonly exitArmed: boolean
  readonly clearEpoch: number
  readonly lastUsage: { totalTokens?: number } | undefined
  readonly backtrack: { composerSeed: string }
  readonly SESSION: {
    cfg: () => { approvalMode: ApprovalMode }
    reloadConfig: () => void
    effort: () => ReasoningEffort
  }
  readonly customCommands: ReadonlyMap<string, { name: string; description?: string }>
  readonly currentSessionId: () => string
  readonly handleSubmit: (text: string) => void
  readonly settleApproval: (approvalId: string, approved: boolean) => void
  readonly backToChat: () => void
  readonly exit: () => void
  readonly setToast: Dispatch<SetStateAction<ToastPayload | null>>
  readonly setComposerText: Dispatch<SetStateAction<string>>
  readonly setPendingQuestion: Dispatch<SetStateAction<string | undefined>>
  readonly setLoginProvider: Dispatch<SetStateAction<string | undefined>>
  readonly setApprovalMode: Dispatch<SetStateAction<ApprovalMode>>
  readonly setEffort: Dispatch<SetStateAction<ReasoningEffort>>
  readonly setShowHelp: Dispatch<SetStateAction<boolean>>
}

type SlotConsent = ReturnType<typeof import('../consent/index.js').useConsent>
// B-011 — the SDK exports this exact shape as `PendingApproval`, and it is the shape
// `findPendingApproval` returns. This file declared a byte-identical copy, making three independent
// declarations of one fact; a field added upstream would reach none of them.

function ApprovalCard({
  approval,
  settleApproval,
}: {
  approval: PendingApproval
  settleApproval: (approvalId: string, approved: boolean) => void
}): ReactElement {
  return (
    <PermissionPrompt
      {...formatApproval(approval)}
      // Under the choices, where Claude Code puts it. Read before the question — which is where the
      // slot rendered until `hintPlacement` existed (usetheokit/theokit-tui) — an instruction about
      // the choices arrives before the choices do.
      hintPlacement="below"
      onDecision={(decision) => {
        settleApproval(approval.approvalId, decision === 'yes')
      }}
    />
  )
}

/**
 * Which surface owns the input row, in precedence order — read top to bottom.
 *
 * B-008 — this was a four-branch ternary inside the JSX, and the ORDER was the contract it
 * recorded nowhere. `selectSurface` (`@theokit/tui`, shipped by B-007 from a measurement of this
 * exact file) evaluates `when` in order and stops at the first that holds, which is what the
 * ternary did — the difference is that the order is now a list a test can read without mounting.
 *
 * Two of these overlap in practice: an approval can be pending while hooks are unreviewed, and
 * while trust is unresolved. Overlap is precedence working, not a defect. The pair that CANNOT
 * overlap is hooks-gate vs trust-gate — the first requires `trusted`, the second `!trusted`.
 *
 * The last layer is unconditional, so the row is never blank. `InputSlot.test.tsx` asserts that
 * rather than trusting it: an edit that makes the fallback conditional should fail a test, not
 * render a hung-looking terminal.
 */
/** `InputSlotProps` with the approval known present — what the `when` predicate proves. */
type WithApproval = InputSlotProps & { readonly pendingApproval: PendingApproval }

export const INPUT_LAYERS: readonly SurfaceLayer<InputSlotProps>[] = [
  {
    name: 'hooks-gate',
    when: (p) => p.trusted && !p.consent.hooksReviewed && p.pendingHooks.length > 0,
    render: (p) => (
      <HooksGate consent={p.consent} pendingHooks={p.pendingHooks} setToast={p.setToast} />
    ),
  },
  {
    name: 'trust-gate',
    when: (p) => !p.trusted,
    render: (p) => (
      <TrustGate
        consent={p.consent}
        SESSION={p.SESSION}
        setToast={p.setToast}
        setApprovalMode={p.setApprovalMode}
        setEffort={p.setEffort}
        exit={p.exit}
      />
    ),
  },
  // B-107 — `narrowingLayer` instead of a cast, and this call site is why it exists.
  //
  // `when` already proved `pendingApproval` is defined; with a plain `SurfaceLayer` the proof was
  // discarded before `render` saw it, and the line below re-asserted it by hand three lines later.
  // That `as PendingApproval` is the evidence @theokit/tui's B-074 was extracted from.
  narrowingLayer<InputSlotProps, WithApproval>({
    name: 'approval',
    when: (p): p is WithApproval => p.pendingApproval !== undefined,
    render: (p) => <ApprovalCard approval={p.pendingApproval} settleApproval={p.settleApproval} />,
  }),
  {
    name: 'conversation',
    when: () => true,
    render: (p) => <ConversationSlot {...p} />,
  },
]

export function InputSlot(props: InputSlotProps): ReactElement {
  return <>{selectSurface(INPUT_LAYERS, props).render()}</>
}
