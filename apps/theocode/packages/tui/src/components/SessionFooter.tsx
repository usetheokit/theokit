import type { ReactElement } from 'react'

import { Text } from 'ink'

import { StatusFooter, footerHintFor } from '@theokit/tui'

import { contextPressure, fmtK } from '../formatting/index.js'
import { AGENTS_PANEL_WIRED } from './composer-capabilities.js'
import { currentWiring } from '../agent-session/wiring-record.js'
import {
  isRightHandItem,
  separatorBefore,
  useStatuslineItems,
  type StatuslineItem,
} from '../session-ui/statusline-session.js'
import type { ApprovalMode } from '../consent/index.js'
import type { ReasoningEffort } from '@theocode/agent/config'

/**
 * B-076 — the sandbox the AGENT was built with, falling back to config before the first turn.
 *
 * It used to read `SESSION.cfg()` unconditionally, so after `/sandbox read-only` the footer kept
 * showing the mode the session started with while the agent had already been rebuilt with another.
 * Two sources, one label, and the label was the wrong one — the shape B-069/B-070/B-071 each had to
 * fix in their own listing.
 */
function sandboxLabel(SESSION: FooterProps['SESSION']): string {
  const wired = currentWiring()?.sandboxMode
  // The `sandbox:` prefix belongs to the LABEL, and the record carries the raw mode — re-added here
  // rather than stored twice, so the two cannot drift into different spellings.
  return wired === undefined ? SESSION.cfg().sandboxLabel : `sandbox:${wired}`
}

export interface FooterProps {
  readonly SESSION: {
    sessionModel: () => string | undefined
    cfg: () => {
      modelLabel: string
      sandboxLabel: string
      contextWindow: { window: number; source: string }
    }
  }
  readonly effort: ReasoningEffort
  readonly approvalMode: ApprovalMode
  readonly goalBadge: string
  readonly credentialSource: () => string
  readonly lastUsage: { inputTokens: number } | undefined
  /** B-046 — whether pressing `?` actually does anything right now. */
  readonly shortcutsAvailable: boolean
}

/**
 * Every left-hand item, resolved to the text it draws.
 *
 * Built as a record rather than a `switch` so that adding a word to `STATUSLINE_ITEMS` without
 * giving it a value is a TYPE error rather than an item that silently renders nothing — which is
 * the failure a `/statusline` user would report as "the command accepted it and did nothing".
 *
 * An empty string means "omit", and `goal` is the reason the rule exists: there is no goal most of
 * the time, and a selection that included it would otherwise leave a dangling separator.
 */
function leftValues(props: FooterProps): Readonly<Record<StatuslineItem, string>> {
  const { SESSION, effort, approvalMode, goalBadge, credentialSource } = props
  return {
    model: SESSION.sessionModel() ?? SESSION.cfg().modelLabel,
    effort,
    approval: approvalMode,
    sandbox: sandboxLabel(SESSION),
    goal: goalBadge,
    auth: credentialSource(),
    // Drawn on the right by `ContextMeter`, so it contributes nothing to the left-hand run. Present
    // in the record because the record is exhaustive over the vocabulary, which is what makes a
    // forgotten item impossible.
    context: '',
  }
}

/**
 * The `·`-joined run, minus whatever `/statusline` dropped.
 *
 * The separator comes from `separatorBefore` rather than from a `join`, so the model and the effort
 * stay one phrase (`gpt-5.6 medium`) exactly as they read before this was configurable.
 */
function statusLine(items: readonly StatuslineItem[], props: FooterProps): string {
  const values = leftValues(props)
  let previous: StatuslineItem | undefined
  let line = ''
  for (const item of items) {
    if (isRightHandItem(item)) continue
    const value = values[item]
    if (value.length === 0) continue
    line += separatorBefore(item, previous) + value
    previous = item
  }
  return line
}

/**
 * The right-hand meter: usage against the window, with the pressure mark and the estimate caveat.
 *
 * Extracted from `SessionFooter` when the left-hand run became a selection — the two are now
 * independently omittable, and keeping both inline put the component past the function-length cap.
 */
function ContextMeter({
  SESSION,
  lastUsage,
}: Pick<FooterProps, 'SESSION' | 'lastUsage'>): ReactElement | null {
  if (!lastUsage) return null
  const window = SESSION.cfg().contextWindow.window
  const pressure = contextPressure(lastUsage.inputTokens, window)
  return (
    <Text>
      {fmtK(lastUsage.inputTokens)}/{fmtK(window)} context
      {/* B-080 — the number alone is data, not a signal: a figure climbing slowly is what
          people stop reading. The mark is the thing the eye catches. */}
      {pressure === 'ok' ? '' : pressure === 'critical' ? ' !!' : ' !'}
      {/* M94 — a FALLBACK budget is a guess, and now presents itself as one. With no
          catalogue entry the resolution falls to the conservative floor, and showing it with
          the same confidence as a measurement made the user trust a number the SDK itself
          labels uncertain — which is precisely what `source` is for. */}
      {SESSION.cfg().contextWindow.source === 'fallback' ? ' (estimated)' : ''}
    </Text>
  )
}

export function SessionFooter(props: FooterProps): ReactElement {
  // Subscribed, not read once: `/statusline` writes to the store from a command handler, and a
  // footer that picked the change up on the next unrelated render would read as a rendering bug
  // rather than as a command — the property `theme-session.tsx` documents for the same shape.
  const items = useStatuslineItems()
  const showContext = items.some(isRightHandItem)
  return (
    <StatusFooter
      left={<Text>{statusLine(items, props)}</Text>}
      // Both conditions, and the second is not redundant: `undefined` is how this asks for NO right
      // region, and an element that renders `null` is not the same thing to a flex row.
      right={
        showContext && props.lastUsage ? (
          <ContextMeter SESSION={props.SESSION} lastUsage={props.lastUsage} />
        ) : undefined
      }
      // B-067 — never `undefined`: that reaches `StatusFooter`'s default parameter, which
      // advertises every affordance the toolkit can do rather than the ones this build wires.
      hint={footerHintFor({ shortcuts: props.shortcutsAvailable, agents: AGENTS_PANEL_WIRED })}
    />
  )
}
