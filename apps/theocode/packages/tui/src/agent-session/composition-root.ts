import { resumeRequested } from './resume-request.js'
import { fireSessionStart } from './session-start.js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveTrustPosture } from '@theocode/agent/config'
import { createSessionPtyOwner, MAX_PTY_SESSIONS } from '@theocode/agent/pty'
import { forkSession } from '@theocode/agent/session'

import { createChatTransport } from './chat-transport.js'
import { credential } from './credential-helpers.js'
import { loadCustomCommands } from '../commands/index.js'
import { forkCurrentSessionWith } from '../persistence/index.js'
import { createTuiSession, type TuiSession } from './tui-session.js'
import { persistSessionId } from '../persistence/index.js'
import { workingDirectory } from '../working-directory.js'

export interface TuiRoot {
  readonly session: TuiSession
  readonly ptyOwner: ReturnType<typeof createSessionPtyOwner>
  readonly transport: ReturnType<typeof createChatTransport>
  readonly sessionPointer: string
  readonly goalPointer: string
  readonly resumeOnStartup: boolean
  readonly customCommands: ReturnType<typeof loadCustomCommands>
  readonly customCommandNames: ReadonlySet<string>
  readonly resetSession: () => void
  readonly sessionFork: () => { newId: string; copied: boolean }
  readonly pointToSession: (id: string) => void
  /** B-055 — install the surface's veto renderer; queued vetoes are replayed into it. */
  readonly onHookVeto: (listen: (veto: { tool: string; reason: string }) => void) => void
}

interface HookVeto {
  tool: string
  reason: string
}

/**
 * B-055 — holds vetoes until the surface has somewhere to show them.
 *
 * The agent is composed before the terminal has a toast, so a hook that blocks during startup would
 * otherwise be announced to nobody. Queueing is the difference between a signal that exists and one
 * the user actually sees.
 */
function createVetoRelay(): {
  emit: (veto: HookVeto) => void
  install: (listen: (veto: HookVeto) => void) => void
} {
  const queued: HookVeto[] = []
  let listener: ((veto: HookVeto) => void) | undefined
  return {
    emit: (veto) => (listener === undefined ? queued.push(veto) : listener(veto)),
    install: (listen) => {
      listener = listen
      for (const v of queued.splice(0)) listen(v)
    },
  }
}

function build(): TuiRoot {
  const cwd = workingDirectory()
  const sessionPointer = join(cwd, '.theokit', 'tui-session')
  // Both halves must hold. `existsSync` answers "is there something to continue"; `resumeRequested`
  // answers "was continuing asked for". Presence alone used to decide it, and since nothing removes
  // the pointer, a directory used once resumed on every later launch with no way to opt out.
  const resumeOnStartup = resumeRequested() && existsSync(sessionPointer)

  const session = createTuiSession({ cwd, sessionPointer, resume: resumeOnStartup })

  // #132 — a launch that does NOT resume is a session starting. Resuming is not: a hook that ran on
  // every resume would be announcing an event that did not happen.
  if (!resumeOnStartup) void fireSessionStart(session.session(), cwd)

  // B-032 — resolved ONCE here and consumed locally. It used to be exposed on `TuiRoot` as well,
  // where nothing read it: a seam built for the injected-directory work that never gained a
  // consumer, and therefore read as though the TUI honoured an injected posture when it does not.
  const initialPosture = resolveTrustPosture(cwd)

  const ptyOwner = createSessionPtyOwner({
    initialMode: session.cfg().sandbox_mode,
    maxSessions: MAX_PTY_SESSIONS,
  })

  const customCommands = loadCustomCommands({
    projectDir: cwd,
    homeDir: homedir(),
    projectTrusted: initialPosture.allows.customCommands,
    warn: (m) => process.stderr.write(`${m}\n`),
  })

  const vetoRelay = createVetoRelay()

  const transport = createChatTransport({
    onHookVeto: vetoRelay.emit,
    getEffort: () => session.effort(),
    getSessionId: () => session.session(),
    getSessionPty: () => ptyOwner,
    takePendingImages: () => session.takeImages(),
    takePendingModel: () => session.takeModel(),
    credential,
  })

  return {
    session,
    ptyOwner,
    transport,
    sessionPointer,
    onHookVeto: vetoRelay.install,
    goalPointer: join(cwd, '.theokit', 'tui-goal.json'),
    resumeOnStartup,
    customCommands,
    customCommandNames: new Set(customCommands.keys()),
    resetSession: () => {
      session.setSession(`tui-${randomUUID()}`)
      ptyOwner.rotate()
      void persistSessionId(sessionPointer, session.session())
      // #132 — `/new` starts a session, so `SessionStart` fires here. NOT through the framework's
      // `on_session_start`: that one is once per loop context, and this product builds an agent per
      // turn, so the mapping would run the hook on every message. `void` because a hook must not
      // hold the frame — #57: `fireSessionStart` itself degrades and reports, including the config
      // read that `/new` repeats, so the bare `void` cannot become an unhandled rejection.
      void fireSessionStart(session.session(), cwd)
    },
    sessionFork: () =>
      forkCurrentSessionWith({
        newId: () => `tui-${randomUUID()}`,
        fork: (from, to) => forkSession(from, to),
        current: () => session.session(),
        commit: (id) => {
          session.setSession(id)
          void persistSessionId(sessionPointer, id)
        },
      }),
    pointToSession: (id) => {
      session.setSession(id)
      void persistSessionId(sessionPointer, id)
    },
  }
}

let root: TuiRoot | undefined

export function getTuiRoot(): TuiRoot {
  root ??= build()
  return root
}
