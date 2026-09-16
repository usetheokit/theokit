import type { ReactElement } from 'react'

import { Box, Text } from 'ink'

import {
  AgentStreaming,
  AgentTimeline,
  DiffViewer,
  Notice,
  Toast,
  UsagePanel,
  composerShortcutsFor,
} from '@theokit/tui'
import { BacktrackOverlay } from '../backtrack/index.js'
import { KeyboardHelp } from '@theokit/tui'

import { THIS_BUILD } from './composer-capabilities.js'

import { formatTurnError } from '../formatting/index.js'
import { THINKING_PHRASES } from '../theme/theme.js'
import { Banner } from './Banner.js'
import type { ContentPanel } from '../rendering/index.js'
import type { ToastPayload } from '../screen-types.js'

export interface ConversationRegionProps {
  readonly clearEpoch: number
  readonly events: Parameters<typeof AgentTimeline>[0]['events']
  readonly streaming: boolean
  readonly elapsed: number
  readonly lastUsage: Parameters<typeof UsagePanel>[0]['usage'] | undefined
  readonly agentError: Error | undefined
  readonly credentialError: () => string | undefined
  readonly panel: ContentPanel | undefined
  readonly showUsage: boolean
  readonly reviewResult: string | null
  readonly goalFeed: string | null
  readonly toast: ToastPayload | null
  readonly contextWindow: number
  readonly backtrack: { armed: boolean; previews: readonly string[]; nth: number; total: number }
  readonly showHelp: boolean
  readonly verbose: boolean
  readonly customCommands: ReadonlyMap<
    string,
    { name: string; hints: string[]; description?: string }
  >
  readonly setToast: (t: ToastPayload | null) => void
}

function ConversationOverlays(props: ConversationRegionProps): ReactElement {
  return (
    <>
      {props.reviewResult !== null ? <Notice>{props.reviewResult}</Notice> : null}
      {/* #63 — the goal feed is rendered LINE BY LINE, each with its own key.
        A multi-line string as the single child makes React reconcile the whole block by index,
        and the arena log showed a flood of `Encountered two children with the same key, '0'`
        during the run. Once reconciliation corrupts, the following `props.setGoalFeed` calls are
        swallowed: the loop completes (`[goal] status=completed turns=3`) with the UI MUTE, which
        is the worst outcome for a progress feed — the user cannot tell whether the loop is alive.

        The key is `index + content`, not the index alone: the feed is append-only, so the index
        by itself would already be stable, but two identical lines in different positions (two
        equal `● status` lines) would collide under a content-based diff. */}
      {props.goalFeed !== null ? (
        <Notice>
          {props.goalFeed.split('\n').map((line, i) => (
            <Text key={`${String(i)}:${line}`}>
              {line}
              {'\n'}
            </Text>
          ))}
        </Notice>
      ) : null}
      {/* M65 — during props.backtrack (the Esc ladder), highlight the selected turn on a NEW surface of
        the live region (not the <Static> timeline, which freezes old cells). Reactive to rewindNth. */}
      {props.backtrack.armed ? (
        <BacktrackOverlay
          previews={[...props.backtrack.previews]}
          selected={props.backtrack.nth}
          count={props.backtrack.total}
        />
      ) : null}
      {props.showHelp ? (
        <KeyboardHelp
          shortcuts={[
            // B-028 / B-006 — the rows THIS build wires, derived by the library from the
            // declaration in `composer-capabilities.ts`. `shell` is absent there by ADR 0001.
            ...composerShortcutsFor(THIS_BUILD),
            // Not derivable from `composer-capabilities.ts`: that declares what the COMPOSER can
            // do, and this key belongs to the transcript above it. A shortcut absent from the help
            // panel is a shortcut nobody finds — which is the whole reason the panel exists.
            {
              keys: 'ctrl+o',
              description: 'show the detailed transcript (tool cards) instead of the count lines',
            },
            ...[...props.customCommands.values()].map((c) => ({
              keys: `/${c.name}${c.hints.length > 0 ? ` ${c.hints.join(' ')}` : ''}`,
              description: c.description ?? 'custom command',
            })),
          ]}
        />
      ) : null}
    </>
  )
}

/**
 * B-011 — the `/diff` and `/status` panel.
 *
 * `DiffViewer` takes unified-diff text, which is exactly what `git diff` emits and what its own
 * docstring names as the shape agent tools produce. The panel used to print that text as one plain
 * blob: no gutter, no colour, no folding, and cut off by the terminal because nothing scrolled.
 */
function ContentPanelView({ panel }: { panel: ContentPanel }): ReactElement {
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>{panel.title} (Esc to close)</Text>
      {panel.body.length > 0 ? <Text>{panel.body}</Text> : null}
      {panel.patch !== undefined ? (
        <DiffViewer patch={panel.patch} maxLines={400} contextLines={3} />
      ) : null}
    </Box>
  )
}

export function ConversationRegion(props: ConversationRegionProps): ReactElement {
  return (
    <>
      {/*
        `verbose` and `footer` are the toolkit's (usetheokit/theokit-tui#61), and the note under the
        transcript is ours because the key binding is: the component exposes the flag, the app owns
        which key flips it. Rendered only while verbose, matching Claude Code — a collapsed
        transcript is the resting state and does not need to announce itself.
      */}
      <AgentTimeline
        key={props.clearEpoch}
        events={props.events}
        header={<Banner />}
        verbose={props.verbose}
        footer={
          props.verbose ? (
            <Text dimColor>Showing detailed transcript · ctrl+o to toggle</Text>
          ) : undefined
        }
      />

      {props.streaming ? (
        <AgentStreaming
          phrases={THINKING_PHRASES}
          shimmer
          elapsedSeconds={props.elapsed}
          tokens={props.lastUsage?.totalTokens}
          tokenDirection="down"
          showCancelHint
        />
      ) : null}
      {/* M30 — a credential problem is surfaced AT STARTUP with its actionable message, not
          swallowed until a turn fails. The DoD is explicit that validation happens at startup:
          a key declared for one provider that carries another's prefix, a world-readable file,
          or nothing configured at all must all say so here, with the fix. */}
      {props.credentialError() !== undefined ? (
        <Notice variant="error">{props.credentialError()}</Notice>
      ) : null}
      {/* M85 — branches: a transient error points at /retry, a fatal one does not (retrying would not help). */}
      {props.agentError ? (
        <Notice variant="error">{formatTurnError(props.agentError)}</Notice>
      ) : null}
      {/* `/usage` — the observability panel, from the last turn's real usage. */}
      {props.panel !== undefined ? <ContentPanelView panel={props.panel} /> : null}
      {props.showUsage && props.lastUsage ? (
        <UsagePanel usage={props.lastUsage} contextWindow={props.contextWindow} />
      ) : null}
      {/* A transient outcome banner (a demo answered, a task finished). Auto-dismisses after 5s. */}
      {props.toast ? (
        <Toast
          message={props.toast.message}
          variant={props.toast.variant}
          durationMs={props.toast.durationMs}
          onDismiss={() => props.setToast(null)}
        />
      ) : null}

      <ConversationOverlays {...props} />
    </>
  )
}
