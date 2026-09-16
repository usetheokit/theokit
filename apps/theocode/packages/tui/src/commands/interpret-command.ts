import {
  handleCopy,
  handleExport,
  handleListHooks,
  handleListMcp,
  handleListSkills,
  handleSandbox,
  handleListSubagents,
} from './transcript-commands.js'

import { CLEAR_SCREEN_AND_SCROLLBACK } from '@theokit/tui/terminal'
import {
  handleApprovalMode,
  handleCustomCommand,
  handleEffort,
  handleImage,
  handleRetry,
} from './config-commands.js'
import {
  handleArchive,
  handleDelete,
  handleCompact,
  handleFork,
  handleListSessions,
  handleLogin,
  handleLogout,
  handleMemoryInfo,
  handleResume,
  handleRename,
} from './session-commands.js'
import type {
  CommandCapabilities,
  SessionAndScreenCapabilities,
  IdentityCapabilities,
  TurnCapabilities,
  InspectionCapabilities,
  SettingsCapabilities,
  ShellCapabilities,
  SteeringCapabilities,
} from './command-capabilities.js'
import { initAgents, sendMessage, diffPanel, statusPanel, switchModel } from './command-content.js'
import { currentWiring } from '../agent-session/wiring-record.js'
import { handleAgents } from './agents-panel.js'
import { permissionsPanel } from './permissions-panel.js'
import { storeThemeBase, themeStorePath } from '../theme/theme-store.js'
import { handleTheme } from './theme-command.js'
import { handleStatusline, handleTitle } from './surface-commands.js'
import { handleRaw } from './raw-command.js'
import { handleListPtys, handleStopPtys } from './pty-commands.js'
import { handleGoalVerb } from './goal.js'
import { runReviewCommand } from './review.js'
import type { CommandAction } from './registry.js'
import { workingDirectory } from '../working-directory.js'
import { codexNameAnswer } from './codex-names.js'

export function interpretCommand(
  action: CommandAction,
  text: string,
  cap: CommandCapabilities,
): void {
  // The cast is the one seam the type system cannot close by itself: indexing `HANDLERS` with a
  // union key yields a union of handler signatures, and TypeScript intersects their parameters down
  // to `never` (TS#30581) rather than pairing each key with its own action. The pairing it cannot
  // see is precisely what the Record's declaration proves — `HANDLERS[k]` is by construction the
  // handler written for `k` — so the assertion restates a fact the compiler already checked.
  //
  // `| undefined` because `CommandAction` is a compile-time promise and dispatch happens at runtime:
  // a value cast through `as CommandAction` arrives with a kind no key covers, and the chain this
  // replaced answered that by falling out of its loop without effect. Same answer here, so an
  // action added to the registry before its handler stays inert instead of throwing at the user.
  const handler = HANDLERS[action.kind] as
    ((action: CommandAction, text: string, cap: CommandCapabilities) => void) | undefined
  handler?.(action, text, cap)
}

type CommandHandlers = {
  [K in CommandAction['kind']]: (
    action: Extract<CommandAction, { kind: K }>,
    text: string,
    cap: CommandCapabilities,
  ) => void
}

/**
 * One entry per `CommandAction` kind — and the type is what makes that claim checkable.
 *
 * This replaced a chain of eight predicate functions, each a `switch` over `action.kind` answering
 * the boolean "did I claim this". The 47 kinds partitioned cleanly across them, no kind appearing
 * twice, so the order of the chain was inert; the only thing enforcing the partition was a test
 * that read this file's own source with a regex and counted `case` labels. An exhaustive
 * `Record<CommandAction['kind'], …>` moves that invariant into the compiler instead: a kind with no
 * entry fails to typecheck, and a kind claimed twice cannot be written at all, because a repeated
 * key is the same key. The regex test went with the chain it was guarding.
 *
 * The section comments below are those groups' docblocks, which carried reasoning worth keeping.
 * What they no longer carry is the three notes that justified a command's placement by the
 * `complexity: 10` budget of the switch it sat in: the switches are gone, one entry costs the same
 * wherever it sits, and a placement argument that outlives the lint it cited is a claim no reader
 * can check. The subject-matter halves of those notes stayed.
 *
 * `cap` is annotated narrowly per entry rather than left to widen to `CommandCapabilities`, and
 * that is load-bearing rather than tidy: `SettingsCapabilities` is what withholds `setApprovalMode`
 * from the read-only panels, so a handler typed by it cannot grow a second route around the armed
 * confirmation `/sandbox` puts in front of a loosening. The declared parameter above is the wide
 * type, so every narrow annotation is checked against it — widening one is possible, doing it by
 * accident is not.
 */
const HANDLERS: CommandHandlers = {
  // ---- session and screen ----------------------------------------------------------------------

  // Explicit, because a Record has no equivalent of the chain's bare `return true`: "claimed, and
  // does nothing" has to be written down or the type is not exhaustive. An empty composer line
  // routes here (`registry.ts`), so the empty body IS the behaviour.
  noop: () => {},
  new: resetConversation,
  clear: resetConversation,
  effort: (action, _text, cap: SessionAndScreenCapabilities) => {
    handleEffort(action.arg, {
      getEffort: () => cap.SESSION.effort(),
      setModuleEffort: (level) => {
        cap.SESSION.setEffort(level)
      },
      setEffort: cap.setEffort,
      setToast: cap.setToast,
    })
  },
  toggleHelp: (_action, _text, cap: SessionAndScreenCapabilities) => {
    cap.setShowHelp((h) => !h)
  },
  toggleUsage: (_action, _text, cap: SessionAndScreenCapabilities) => {
    toggleUsagePanel(cap.hasLastUsage, cap.setShowUsage, cap.setToast)
  },
  // Answered with one toast: it renders nothing and starts no turn, which is why it never reaches
  // the model as prose the way an unrecognised slash used to.
  codexName: (action, _text, cap: SessionAndScreenCapabilities) => {
    cap.setToast({ message: codexNameAnswer(action.name), variant: 'info' })
  },

  // ---- identity --------------------------------------------------------------------------------

  logout: (_action, _text, cap: IdentityCapabilities) => {
    handleLogout(cap.setToast)
  },
  login: (action, _text, cap: IdentityCapabilities) => {
    handleLogin(action.arg, cap.setToast, (provider) => {
      cap.setLoginProvider(provider)
    })
  },
  fork: (_action, _text, cap: IdentityCapabilities) => {
    handleFork(cap.forkCurrentSession, cap.setToast)
  },
  listSessions: (_action, _text, cap: IdentityCapabilities) => {
    handleListSessions(cap.currentSessionId, cap.setToast)
  },
  resume: (action, _text, cap: IdentityCapabilities) => {
    handleResume(action.arg, {
      currentSessionId: cap.currentSessionId,
      streaming: cap.streaming,
      setSessionAndPersist: cap.setSessionAndPersist,
      setClearEpoch: cap.setClearEpoch,
      setResumed: cap.setResumed,
      setToast: cap.setToast,
    })
  },
  archive: (action, _text, cap: IdentityCapabilities) => {
    handleArchive(action.arg, {
      currentSessionId: cap.currentSessionId,
      resetSession: cap.resetSession,
      setToast: cap.setToast,
    })
  },
  delete: (action, _text, cap: IdentityCapabilities) => {
    handleDelete(action.arg, { setToast: cap.setToast })
  },
  rename: (action, _text, cap: IdentityCapabilities) => {
    handleRename(action.arg, cap.currentSessionId, cap.setToast)
  },

  // ---- turn ------------------------------------------------------------------------------------

  image: (action, _text, cap: TurnCapabilities) => {
    handleImage(action.arg, {
      setPendingImages: (images) => {
        cap.SESSION.attachImages(images)
      },
      setToast: cap.setToast,
    })
  },
  retry: (_action, _text, cap: TurnCapabilities) => {
    handleRetry({
      lastSent: cap.lastSentMessage.current,
      send: (message) => cap.agent.send({ message }),
      setToast: cap.setToast,
    })
  },
  mode: (action, _text, cap: TurnCapabilities) => {
    cap.setMode(action.mode)
  },
  approvalMode: (action, _text, cap: TurnCapabilities) => {
    handleApprovalMode(action.arg, { setApprovalMode: cap.setApprovalMode, setToast: cap.setToast })
  },
  custom: (action, text, cap: TurnCapabilities) => {
    handleCustomCommand(action.name, action.arg, text, cap.customCommands.get(action.name), {
      send: (message) => cap.agent.send({ message }),
      setLastSent: (message) => {
        cap.lastSentMessage.current = message
      },
      setPendingModel: (model) => {
        cap.SESSION.setModel(model)
      },
      setToast: cap.setToast,
    })
  },

  // ---- inspection ------------------------------------------------------------------------------

  quit: (_action, _text, cap: InspectionCapabilities) => {
    cap.exit()
  },
  // A toast, not a panel: this is the shape `/model` with no argument already uses for a one-value
  // answer, and a bordered panel holding a single line would read as a bug.
  pwd: (_action, _text, cap: InspectionCapabilities) => {
    cap.setToast({ message: workingDirectory(), variant: 'info' })
  },
  // B-077 — inspection, not turn: it renders a panel and starts no turn.
  memoryInfo: (action, _text, cap: InspectionCapabilities) => {
    handleMemoryInfo(action.arg, cap.setToast, cap.setPanel, cap.SESSION.cfg().memory)
  },
  showStatus: (_action, _text, cap: InspectionCapabilities) => {
    cap.setPanel(
      statusPanel(
        cap.SESSION,
        cap.approvalMode,
        cap.currentSessionId,
        cap.ptyOwner,
        currentWiring(),
      ),
    )
  },
  initAgents: (_action, _text, cap: InspectionCapabilities) => {
    initAgents(cap.agent, cap.lastSentMessage, cap.setToast)
  },
  showDiff: (_action, _text, cap: InspectionCapabilities) => {
    const panel = diffPanel()
    if (panel === undefined) {
      cap.setToast({ message: 'no diff: this directory is not a git repository', variant: 'info' })
      return
    }
    cap.setPanel(panel)
  },
  model: (action, _text, cap: InspectionCapabilities) => {
    switchModel(action.arg, cap.SESSION, cap.setToast)
  },
  compact: (_action, _text, cap: InspectionCapabilities) => {
    handleCompact(cap.SESSION.session(), cap.setToast)
  },

  // ---- transcript out --------------------------------------------------------------------------
  //
  // B-075 — getting the conversation OUT of the terminal. Apart from the inspection entries above
  // because the subject differs: those render a panel back into the TUI, these hand text to
  // something outside it.
  //
  // The four inventories sit behind them, and `/agents` belongs here rather than with the session
  // verbs: it renders the `/subagents` listing above the `/sessions` one, so it sits beside the
  // entries whose work it repeats.

  copy: (_action, _text, cap: InspectionCapabilities) => {
    handleCopy(cap.events, cap.setToast)
  },
  export: (action, _text, cap: InspectionCapabilities) => {
    handleExport(action.arg, cap.events, cap.currentSessionId, cap.setToast)
  },
  listSubagents: (_action, _text, cap: InspectionCapabilities) => {
    handleListSubagents(cap.setPanel)
  },
  showAgents: (_action, _text, cap: InspectionCapabilities) => {
    handleAgents(cap.currentSessionId, cap.setPanel, cap.setToast)
  },
  listHooks: (_action, _text, cap: InspectionCapabilities) => {
    handleListHooks(cap.setPanel)
  },
  listSkills: (_action, _text, cap: InspectionCapabilities) => {
    handleListSkills(cap.setPanel)
  },
  listMcp: (_action, _text, cap: InspectionCapabilities) => {
    handleListMcp(cap.setPanel)
  },
  sandbox: (action, _text, cap: InspectionCapabilities) => {
    handleSandbox(action.arg, () => cap.SESSION.cfg().sandboxLabel, cap.setToast)
  },
  // Here rather than with the settings knobs, because this section's subject is exactly what `/raw`
  // does: it hands text to something outside the frame. Its two neighbours put a reply on the
  // clipboard and in a file; this one puts it in the terminal's own scrollback.
  raw: (action, _text, cap: InspectionCapabilities) => {
    handleRaw(action.arg, cap.events, cap.writeToScrollback, cap.setToast)
  },

  // ---- settings --------------------------------------------------------------------------------
  //
  // The knobs — `/permissions` shows the approval and sandbox posture on one screen, `/theme` shows
  // the colour base and switches it for the session, and `/title` and `/statusline` choose which
  // facts the terminal's tab and the footer carry.
  //
  // The two newest are one action each because the surfaces they configure are subscribed to their
  // stores (`statusline-session.ts`, `title-session.ts`). Nothing has to be re-rendered from here —
  // the write notifies, which is the property `theme-session.tsx` documents as load-bearing.
  //
  // `/permissions` still only reports, and that is the design rather than an unfinished half. Its
  // setters stay where they are — `/approval` with the turn entries, `/sandbox` with the
  // transcript ones — because the sandbox one arms a confirmation before a loosening, and a second
  // route to the same value would either duplicate that guard or walk around it. `/theme` has no
  // such guard to respect: the colour base grants nothing, so the command that reports it is also
  // the one that sets it. `SettingsCapabilities` is what holds that line — see the Record's
  // docblock on why the narrow annotations are not decoration.

  showPermissions: (_action, _text, cap: SettingsCapabilities) => {
    cap.setPanel(permissionsPanel(cap.approvalMode, cap.SESSION.cfg().sandboxDetail))
  },
  theme: (action, _text, cap: SettingsCapabilities) => {
    handleTheme(action.arg, cap.setToast, storeThemeBase, themeStorePath)
  },
  title: (action, _text, cap: SettingsCapabilities) => {
    handleTitle(action.arg, cap)
  },
  statusline: (action, _text, cap: SettingsCapabilities) => {
    handleStatusline(action.arg, cap)
  },

  // ---- shells ----------------------------------------------------------------------------------

  listPtys: (_action, _text, cap: ShellCapabilities) => {
    handleListPtys(cap.ptyOwner, cap.setToast)
  },
  stopPtys: (_action, _text, cap: ShellCapabilities) => {
    handleStopPtys(cap.ptyOwner, cap.setToast)
  },

  // ---- conduct ---------------------------------------------------------------------------------

  review: (action, _text, cap: SteeringCapabilities) => {
    void runReviewCommand(
      action.arg,
      { getSessionId: cap.currentSessionId },
      { setReviewResult: cap.setReviewResult, setToast: cap.setToast },
    )
  },
  goal: (action, _text, cap: SteeringCapabilities) => {
    handleGoalVerb(
      action.arg,
      { goalRun: cap.goalRun, goalActive: cap.goalActive },
      {
        goalAbort: cap.goalAbort,
        agent: cap.agent,
        setGoalRun: cap.setGoalRun,
        setGoalFeed: cap.setGoalFeed,
        setToast: cap.setToast,
        setComposerSeed: cap.backtrack.setSeed,
        setClearEpoch: cap.setClearEpoch,
        startGoal: cap.startGoal,
      },
    )
  },
  send: (action, _text, cap: SteeringCapabilities) => {
    sendMessage(action.text, cap.goalActive, cap.agent, cap.lastSentMessage, cap.setToast)
  },
  commandError: (action, _text, cap: SteeringCapabilities) => {
    // The half that makes the router's refusal worth having: it has to be SAID.
    //
    // A slash that names nothing used to reach the model as prose and come back answered, so the
    // user read a plausible reply to a command that never ran. Refusing it silently would trade
    // that for a keystroke that does nothing — visibly worse to use, and no easier to diagnose.
    cap.setToast({
      message: `${action.input} — ${action.reason.replaceAll('-', ' ')}`,
      variant: 'error',
    })
  },
}

/**
 * `/new` and `/clear` are one behaviour under two names, so they are one handler under two keys.
 *
 * Written out rather than duplicated: the chain expressed the sharing as a `case` fall-through, and
 * a Record expresses it by pointing both keys at the same function. Copying the body into each key
 * would be the version where the two commands drift apart without anyone deciding they should.
 */
function resetConversation(
  _action: CommandAction,
  _text: string,
  cap: SessionAndScreenCapabilities,
): void {
  cap.resetSession()
  // #70 — the screen stops claiming a continuation. `use-screen-state.ts` documented the pair as
  // "`/resume` sets it, `/new` clears it" and only the first half was implemented, so after
  // `/resume` then `/new` the greeting still announced one — and the restored turns waited on a
  // session-id change to disappear rather than on the command the user typed.
  cap.setResumed(false)
  cap.agent.reset()
  cap.SESSION.attachImages(undefined)
  cap.backtrack.setSeed('')
  cap.goalAbort.current?.abort()
  cap.goalAbort.current = null
  cap.setGoalRun(null)
  cap.setGoalFeed(null)
  cap.stdout?.write(CLEAR_SCREEN_AND_SCROLLBACK)
  cap.setClearEpoch((e) => e + 1)
}

/**
 * #58 — `/usage` answers when there is nothing to show, rather than arming an invisible panel.
 *
 * The panel renders on `showUsage && lastUsage` (`ConversationRegion.tsx`), so before the first
 * turn the toggle flipped a flag with nothing behind it: no panel, and no word about why. Worse,
 * the Escape ladder read that flag as "a panel is on screen" and ate the first Escape of the next
 * stream. The ladder is fixed at its own seam; this is the half the operator sees, and it follows
 * `/copy`, which already answers "nothing to copy — the agent has not replied yet".
 */
function toggleUsagePanel(
  hasLastUsage: boolean,
  setShowUsage: SessionAndScreenCapabilities['setShowUsage'],
  setToast: SessionAndScreenCapabilities['setToast'],
): void {
  if (!hasLastUsage) {
    setToast({ message: 'no usage yet — the agent has not finished a turn', variant: 'info' })
    return
  }
  setShowUsage((u) => !u)
}
