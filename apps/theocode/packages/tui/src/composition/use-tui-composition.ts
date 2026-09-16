import {
  credential,
  credentialError,
  credentialSource,
  makeInterruptTurn,
  getTuiRoot,
} from '../agent-session/index.js'
import { composerDeps } from './composer-deps.js'
import { useTuiSession } from './use-tui-session.js'
import { useComposerCommands } from '../commands/index.js'
import { type ApprovalMode, useApprovals, useConsent } from '../consent/index.js'
import { useGoalRun } from '../persistence/index.js'
import {
  useTimeline,
  useScreenState,
  useContextWarning,
  useResumedHistory,
} from '../rendering/index.js'
import { useTuiKeyboard } from '../terminal-io/index.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { homedir } from 'node:os'
import { basename } from 'node:path'

import { AGENT } from '@theocode/shared/agent'

import { workingDirectory } from '../working-directory.js'

import { currentQuestion, setListener } from '@theocode/agent/ask'
import { installAuthHome } from '@theocode/agent/auth'
import { installClaudeProjectDir } from '@theocode/agent/hooks'

import { useBacktrack } from '../backtrack/index.js'
import type { ReasoningEffort } from '@theocode/agent/config'

// The same call the CLI's bootstrap makes. It used to be a hand-rolled `??=` here and a function
// call there, which is how the two surfaces came to disagree about whether the variable got set.
installAuthHome(process.env, homedir())
// Beside it for the same reason: a variable the SDK's hook runner will need, supplied before the
// first turn rather than discovered as a denial. See `claude-project-dir.ts` for why it is needed
// at all (usetheokit/theokit-sdk#522).
//
// `process.cwd()` and NOT `workingDirectory()`, which this file imports and uses elsewhere. This
// statement is module-level, so ESM runs it before `main.tsx` reaches `setWorkingDirectory` — the
// hoisting hazard `working-directory.ts` documents. The slot is unset here, and `workingDirectory()`
// falls back to `process.cwd()` anyway, so the two are identical at this point; writing the slot
// accessor would only read as honouring a selection that cannot exist yet, and would start silently
// differing the day the ordering changed. Left explicit, with the reason, because a sweep for direct
// cwd reads will otherwise "fix" it.
installClaudeProjectDir(process.env, process.cwd())

function useConversationState(s: ReturnType<typeof useTuiSession>) {
  const { currentSessionId, SESSION } = s
  const consent = useConsent()
  const trusted = consent.trusted
  const pendingHooks = consent.pendingHooks

  const [pendingQuestion, setPendingQuestion] = useState<string | undefined>(undefined)
  useEffect(
    () => setListener(() => setPendingQuestion(currentQuestion(currentSessionId()))),
    [currentSessionId],
  )
  const { goalRun, setGoalRun, goalActive, goalBadge } = useGoalRun(s.GOAL_POINTER)
  const goalAbort = useRef<AbortController | null>(null)
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => SESSION.cfg().approvalMode)
  const lastSentMessage = useRef<string | null>(null)
  return {
    consent,
    trusted,
    pendingHooks,
    pendingQuestion,
    setPendingQuestion,
    goalRun,
    setGoalRun,
    goalActive,
    goalBadge,
    goalAbort,
    approvalMode,
    setApprovalMode,
    lastSentMessage,
  }
}

function turnInterrupt(d: {
  agent: { abort: () => void }
  streaming: boolean
  pendingApproval: unknown
  forkCurrentSession: ReturnType<typeof getTuiRoot>['sessionFork']
  screen: { setToast: ReturnType<typeof useScreenState>['setToast'] }
}) {
  const { agent, streaming, pendingApproval, forkCurrentSession, screen } = d
  const interruptTurn = makeInterruptTurn({
    abort: () => {
      agent.abort()
    },
    forkSession: forkCurrentSession,
    hasActiveTurn: () => streaming,
    hasPendingApproval: () => pendingApproval !== undefined && pendingApproval !== null,
    onForkFailure: (e) => {
      screen.setToast({
        message: `Interrupt: fork failed — ${(e as Error).message}`,
        variant: 'error',
      })
    },
  })

  return interruptTurn
}

function useInterruptAndBacktrack(d: {
  screen: ReturnType<typeof useScreenState>
  agent: Parameters<typeof useBacktrack>[0]['agent'] & { abort: () => void }
  stdout: Parameters<typeof useBacktrack>[0]['stdout']
  streaming: boolean
  pendingApproval: unknown
  pendingQuestion: string | undefined
  trusted: boolean
  goalActive: boolean
  goalAbort: { current: AbortController | null }
  hasLastUsage: boolean
  currentSessionId: () => string
  forkCurrentSession: ReturnType<typeof getTuiRoot>['sessionFork']
  setSessionAndPersist: ReturnType<typeof getTuiRoot>['pointToSession']
  setPendingQuestion: Dispatch<SetStateAction<string | undefined>>
  exit: () => void
}) {
  const {
    screen,
    agent,
    stdout,
    streaming,
    pendingApproval,
    pendingQuestion,
    trusted,
    goalActive,
    goalAbort,
    hasLastUsage,
    currentSessionId,
    setSessionAndPersist,
    setPendingQuestion,
    exit,
  } = d
  const interruptTurn = turnInterrupt(d)
  const backtrack = useBacktrack({
    agent,
    stdout,
    setToast: screen.setToast,
    setClearEpoch: screen.setClearEpoch,
    currentSessionId,
    setSessionAndPersist,
  })

  useTuiKeyboard({
    screen,
    agent,
    backtrack,
    goalAbort,
    pendingQuestion,
    pendingApproval,
    trusted,
    streaming,
    goalActive,
    hasLastUsage,
    currentSessionId,
    setPendingQuestion,
    interruptTurn,
    exit,
  })

  return backtrack
}

/**
 * B-055 — show a hook veto.
 *
 * It is invisible on the wire: the SDK surfaces a blocked call as a tool_result with
 * `isError: false` and the message as content, so the model can self-correct. The terminal cannot
 * tell a blocked call from a completed one by looking at the result — which is what made B-027's
 * renderer unreachable — so the signal comes from the veto site instead.
 */
function useSessionToasts(
  s: ReturnType<typeof useTuiSession>,
  setToast: ReturnType<typeof useScreenState>['setToast'],
  usedTokens: number | undefined,
): void {
  useEffect(() => {
    s.ROOT.onHookVeto((veto) => {
      setToast({ message: `Blocked ${veto.tool} — ${veto.reason}`, variant: 'error' })
    })
  }, [s.ROOT, setToast])

  // B-080 — warn on the way UP, before the limit lands mid-answer. Grouped here rather than called
  // from the composition root: both are things the SESSION tells the user, and the root is at its
  // line budget — B-085 is what that costs when it is ignored.
  useContextWarning(usedTokens, s.SESSION.cfg().contextWindow.window, (message) => {
    setToast({ message, variant: 'info' })
  })
}

/**
 * The composer's dependency bundle, lifted out of `useTuiComposition` (B-073 follow-up).
 *
 * NOT a design improvement on its own — it exists because `prettier` and `eslint` disagreed about
 * this file. The repository's own formatter expands this call into 18 lines, and
 * `max-lines-per-function` caps the hook at 60. Neither tool is wrong; the file was simply never
 * formatted, and no CI job runs `prettier --check`, so nothing forced the question until now.
 *
 * Behaviour-preserving: the same object, in the same order, to the same call.
 */
function buildComposerDeps(args: {
  s: ReturnType<typeof useTuiSession>
  screen: ReturnType<typeof useScreenState>
  backtrack: ReturnType<typeof useBacktrack>
  conv: ReturnType<typeof useConversationState>
  credential: Parameters<typeof composerDeps>[2]['credential']
  events: Parameters<typeof composerDeps>[3]
  hasLastUsage: boolean
}): ReturnType<typeof composerDeps> {
  const { s, screen, backtrack, conv, credential, events, hasLastUsage } = args
  return composerDeps(
    s,
    screen,
    {
      backtrack,
      goalAbort: conv.goalAbort,
      lastSentMessage: conv.lastSentMessage,
      approvalMode: conv.approvalMode,
      goalRun: conv.goalRun,
      goalActive: conv.goalActive,
      hasLastUsage,
      setGoalRun: conv.setGoalRun,
      setApprovalMode: conv.setApprovalMode,
      credential,
    },
    events,
  )
}

export function useTuiComposition() {
  const s = useTuiSession()
  const { agent, currentSessionId, stdout, streaming } = s
  const screen = useScreenState(s.ROOT.resumeOnStartup)

  const conv = useConversationState(s)
  const { setMode } = screen
  const backToChat = useCallback(() => setMode('chat'), [setMode])

  // #70 — what the session already contained, read once per resume and drawn ahead of the live
  // thread. Empty for a fresh session, which is every session that did not come from `/resume` or
  // from starting on a session pointer.
  // `currentSessionId()` and not the callback: this reads the id at RENDER, which is what changes
  // when `/resume` repoints the session and re-renders. Passing the callback would hand the hook a
  // stable identity that never signals the switch.
  const history = useResumedHistory(currentSessionId(), screen.resumed)
  const { events, lastUsage } = useTimeline(agent, screen.resumed, history)
  useSessionToasts(s, screen.setToast, lastUsage?.inputTokens)
  const posture = s.SESSION.cfg().sandboxPosture
  const { pendingApproval, settleApproval } = useApprovals(agent, conv.approvalMode, posture)

  // #58 — derived ONCE. The Escape ladder and `/usage` both need to know whether there is anything
  // to draw, and the panel's render condition is `showUsage && lastUsage`: re-deriving it in either
  // consumer is how the halves drifted apart in the first place.
  const hasLastUsage = lastUsage !== undefined

  const backtrack = useInterruptAndBacktrack({
    screen,
    agent,
    stdout,
    streaming,
    pendingApproval,
    pendingQuestion: conv.pendingQuestion,
    trusted: conv.trusted,
    goalActive: conv.goalActive,
    goalAbort: conv.goalAbort,
    hasLastUsage,
    currentSessionId,
    forkCurrentSession: s.forkCurrentSession,
    setSessionAndPersist: s.setSessionAndPersist,
    setPendingQuestion: conv.setPendingQuestion,
    exit: s.exit,
  })

  const { handleSubmit } = useComposerCommands(
    buildComposerDeps({ s, screen, backtrack, conv, credential, events, hasLastUsage }),
  )

  const c = {
    ...s,
    ...conv,
    screen,
    backToChat,
    pendingApproval,
    settleApproval,
    events,
    lastUsage,
    backtrack,
    handleSubmit,
    credentialError,
    credentialSource,
  }
  return {
    conversationProps: conversationProps(c),
    slotProps: slotProps(c),
    footerProps: footerProps(c),
    titleProps: titleProps(c),
  }
}

type Composition = Parameters<typeof conversationProps>[0]

function conversationProps(c: {
  screen: ReturnType<typeof useScreenState>
  events: ReturnType<typeof useTimeline>['events']
  streaming: boolean
  elapsed: number
  lastUsage: ReturnType<typeof useTimeline>['lastUsage']
  agent: { error?: Error }
  credentialError: () => string | undefined
  SESSION: { cfg: () => { contextWindow: { window: number } } }
  backtrack: ReturnType<typeof useBacktrack>
  customCommands: ReturnType<typeof getTuiRoot>['customCommands']
}) {
  return {
    clearEpoch: c.screen.clearEpoch,
    events: c.events,
    streaming: c.streaming,
    elapsed: c.elapsed,
    lastUsage: c.lastUsage,
    agentError: c.agent.error,
    credentialError: c.credentialError,
    panel: c.screen.panel,
    showUsage: c.screen.showUsage,
    reviewResult: c.screen.reviewResult,
    goalFeed: c.screen.goalFeed,
    toast: c.screen.toast,
    contextWindow: c.SESSION.cfg().contextWindow.window,
    backtrack: c.backtrack,
    showHelp: c.screen.showHelp,
    verbose: c.screen.verbose,
    customCommands: c.customCommands,
    setToast: c.screen.setToast,
  }
}

function slotProps(c: Composition & SlotExtras) {
  return {
    customCommands: c.customCommands,
    trusted: c.trusted,
    consent: c.consent,
    pendingHooks: c.pendingHooks,
    pendingApproval: c.pendingApproval,
    pendingQuestion: c.pendingQuestion,
    loginProvider: c.screen.loginProvider,
    mode: c.screen.mode,
    elapsed: c.elapsed,
    exitArmed: c.screen.exitArmed,
    clearEpoch: c.screen.clearEpoch,
    lastUsage: c.lastUsage,
    backtrack: c.backtrack,
    SESSION: c.SESSION,
    currentSessionId: c.currentSessionId,
    handleSubmit: c.handleSubmit,
    settleApproval: c.settleApproval,
    backToChat: c.backToChat,
    exit: c.exit,
    setToast: c.screen.setToast,
    setComposerText: c.screen.setComposerText,
    setPendingQuestion: c.setPendingQuestion,
    setLoginProvider: c.screen.setLoginProvider,
    setApprovalMode: c.setApprovalMode,
    setEffort: c.setEffort,
    setShowHelp: c.screen.setShowHelp,
  }
}

function footerProps(c: Composition & FooterExtras) {
  return {
    SESSION: c.SESSION,
    effort: c.effort,
    approvalMode: c.approvalMode,
    goalBadge: c.goalBadge,
    credentialSource: c.credentialSource,
    lastUsage: c.lastUsage,
    // B-046 — the same condition `input-router.ts` gates `?` on. The footer advertised the shortcut
    // unconditionally, including while another surface was mounted or the composer had text, when
    // pressing it does nothing.
    shortcutsAvailable: c.screen.composerText.trim().length === 0,
  }
}

/**
 * The facts behind the terminal's window title, gathered where every wire already meets.
 *
 * Read on every render rather than captured once, which is the whole requirement: `/model` and
 * `/fork` both change what the tab should say, and a title computed at startup describes a session
 * that stopped existing. `TerminalTitle` compares the COMPOSED text, so a render that changes
 * nothing emits nothing.
 *
 * `dir` is the leaf, not the path. A tab is a few dozen columns wide and the tail is the half that
 * distinguishes one checkout from another; `/status` and `/pwd` are where the full path is read.
 */
function titleProps(c: TitleExtras) {
  return {
    out: c.stdout,
    facts: {
      app: AGENT.name,
      dir: basename(workingDirectory()),
      model: c.SESSION.sessionModel() ?? c.SESSION.cfg().modelLabel,
      session: c.currentSessionId(),
    },
  }
}

interface TitleExtras {
  stdout: ReturnType<typeof useTuiSession>['stdout']
  currentSessionId: () => string
  SESSION: ReturnType<typeof getTuiRoot>['session']
}

interface SlotExtras {
  trusted: boolean
  consent: ReturnType<typeof useConsent>
  pendingHooks: ReturnType<typeof useConsent>['pendingHooks']
  pendingApproval: ReturnType<typeof useApprovals>['pendingApproval']
  pendingQuestion: string | undefined
  currentSessionId: () => string
  handleSubmit: (text: string) => void
  settleApproval: ReturnType<typeof useApprovals>['settleApproval']
  backToChat: () => void
  exit: () => void
  setPendingQuestion: Dispatch<SetStateAction<string | undefined>>
  setApprovalMode: Dispatch<SetStateAction<ApprovalMode>>
  setEffort: Dispatch<SetStateAction<ReasoningEffort>>
  SESSION: ReturnType<typeof getTuiRoot>['session']
}

interface FooterExtras {
  effort: ReasoningEffort
  approvalMode: ApprovalMode
  goalBadge: string
  credentialSource: () => string
  SESSION: ReturnType<typeof getTuiRoot>['session']
}
