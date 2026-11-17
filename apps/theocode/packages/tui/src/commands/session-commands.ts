import { compactReport } from './compact-report.js'
import {
  memoryFacts,
  withFactRemoved,
  memoryEnabledForSession,
  setMemoryEnabledForSession,
} from '@theocode/agent'
import { planResume } from './resume-command.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Dispatch, SetStateAction } from 'react'

import {
  archiveSession,
  deleteSession,
  compactSession,
  legacyRootHint,
  listSessions,
  renameSession,
} from '@theocode/agent/session'
import { resolveTrustPosture } from '@theocode/agent/config'
import { logout, methodsFor, oauthDeviceLogin, knownProviders } from '@theocode/agent/auth'
import type { AuthMethod } from '@theokit/agents/auth'
import type { ContentPanel, ToastPayload } from '../screen-types.js'
import { workingDirectory } from '../working-directory.js'

type SetPanel = (panel: ContentPanel) => void
type SetToast = Dispatch<SetStateAction<ToastPayload | null>>

const KNOWN_PROVIDERS = knownProviders()

function knownMethodsFor(name: string): readonly AuthMethod[] | undefined {
  const p = KNOWN_PROVIDERS.includes(name) ? name : undefined
  return p === undefined ? undefined : methodsFor(p)
}

function loginAnnouncement(arg: string): {
  provider: string
  message: string
  canDevice: boolean
} {
  const provider = arg.trim().length > 0 ? arg.trim() : 'openai'
  const methods = knownMethodsFor(provider)
  if (methods === undefined) {
    return {
      provider,
      message: `unknown provider "${provider}". Known: ${KNOWN_PROVIDERS.join(', ')}.`,
      canDevice: false,
    }
  }
  const labels = methods.map((m) => m.label).join(' · ')
  const canDevice = methods.some((m) => m.type === 'oauth')
  return {
    provider,
    message: canDevice
      ? `Login methods for ${provider}: ${labels}`
      : `${provider} offers no device login. Use: ${labels}.`,
    canDevice,
  }
}

export function handleLogout(setToast: SetToast): void {
  const removed = logout(homedir())
  setToast({
    message: removed ? 'Logged out — credential file removed' : 'Not logged in',
    variant: 'info',
  })
}

const DEVICE_PROMPT_DURATION_MS = 10 * 60_000

export function handleLogin(
  arg: string,
  setToast: SetToast,
  askForKey?: (provider: string) => void,
  deps?: { oauth?: typeof oauthDeviceLogin },
): void {
  const parts = arg
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  const askedForKey = parts.at(-1)?.toLowerCase() === 'key'
  const withoutSelector = (askedForKey ? parts.slice(0, -1) : parts).join(' ')

  const announcement = loginAnnouncement(withoutSelector)
  setToast({ message: announcement.message, variant: 'info' })

  if (askedForKey || !announcement.canDevice) {
    if (askForKey !== undefined) askForKey(announcement.provider)
    return
  }

  const start = deps?.oauth ?? oauthDeviceLogin
  void start(announcement.provider as Parameters<typeof oauthDeviceLogin>[0], homedir(), {
    onPrompt: ({ userCode, verificationUri }) =>
      setToast({
        message: `Open ${verificationUri} and enter code: ${userCode}`,
        variant: 'info',
        durationMs: DEVICE_PROMPT_DURATION_MS,
      }),
  })
    .then((r) =>
      setToast({
        message: `Logged in via OAuth (${r.provider})${r.accountId !== undefined ? ` — account ${r.accountId}` : ''}. Restart to refresh the footer.`,
        variant: 'success',
      }),
    )
    .catch((e: unknown) =>
      setToast({ message: `Login failed: ${(e as Error).message}`, variant: 'error' }),
    )
}

export function handleFork(
  forkCurrentSession: () => { newId: string; copied: boolean },
  setToast: SetToast,
): void {
  let result: { newId: string; copied: boolean }
  try {
    result = forkCurrentSession()
  } catch (e) {
    setToast({ message: `Fork failed: ${(e as Error).message}`, variant: 'error' })
    return
  }
  const { newId, copied } = result
  setToast({
    message: copied
      ? `Forked → ${newId} — the context was copied; this session continues from it.`
      : `Forked → ${newId} — no prior transcript yet, so a fresh session.`,
    variant: 'success',
  })
}

/** What the store hands back for a listing, taken from the function so the two cannot drift. */
export type ListedSessions = Awaited<ReturnType<typeof listSessions>>

/**
 * One line per session, shared by the `/sessions` toast and the `/agents` panel.
 *
 * The id is printed even when the session has a name, and that is a fix rather than a style: the id
 * is the argument `/resume`, `/archive` and `/delete` take, and the previous line showed `name ??
 * agentId` — so renaming a session hid the only handle you could act on it with.
 *
 * One renderer for one listing, because the `●` encodes a claim about which session you are in, and
 * two places computing that is how a panel and a toast come to point at different rows.
 */
export function sessionListLines(sessions: ListedSessions, currentId: string): string {
  return sessions
    .map((s) => {
      const named = s.name === undefined ? '' : ` — ${s.name}`
      const marker = s.agentId === currentId ? '● ' : '  '
      return `${marker}${s.agentId}${named}${s.archived ? ' (archived)' : ''}`
    })
    .join('\n')
}

export function handleListSessions(currentSessionId: () => string, setToast: SetToast): void {
  const cur = currentSessionId()
  void listSessions()
    .then((sessions) => {
      if (sessions.length === 0) {
        const hint = legacyRootHint(0, join(homedir(), '.theokit'))
        setToast({ message: hint ?? 'No sessions yet.', variant: 'info' })
        return
      }
      const lines = sessionListLines(sessions, cur)
      setToast({ message: `Sessions (${sessions.length}):\n${lines}`, variant: 'info' })
    })
    .catch((e: unknown) =>
      setToast({ message: `List failed: ${(e as Error).message}`, variant: 'error' }),
    )
}

export function handleArchive(
  arg: string,
  deps: { currentSessionId: () => string; resetSession: () => void; setToast: SetToast },
): void {
  const { currentSessionId, resetSession, setToast } = deps
  const target = arg.trim().length > 0 ? arg.trim() : currentSessionId()
  const isCurrent = target === currentSessionId()
  void archiveSession(target)
    .then(() => {
      if (isCurrent) resetSession()
      setToast({
        message: `Archived ${target}${isCurrent ? ' — started a fresh session.' : '.'}`,
        variant: 'success',
      })
    })
    .catch((e: unknown) =>
      setToast({ message: `Archive failed: ${(e as Error).message}`, variant: 'error' }),
    )
}

/**
 * B-078 — permanent deletion, deliberately harder to reach than archiving.
 *
 * `/delete` REQUIRES the id. Archiving defaults to the current session because it is reversible;
 * this is not, so there is no gesture that destroys a transcript without naming it. Typing the id
 * IS the confirmation step — recorded as a choice, not an omission: a two-key armed confirm was not
 * built, and would be the stronger guard if this ever defaults to the current session.
 */
export function handleDelete(arg: string, deps: { setToast: SetToast }): void {
  const { setToast } = deps
  const target = arg.trim()
  if (target.length === 0) {
    setToast({
      message:
        'delete needs the session id: /delete <id> — it is permanent and does not default to the ' +
        'current session. Use /sessions to see them, or /archive to hide one reversibly.',
      variant: 'info',
    })
    return
  }
  void deleteSession(target)
    .then((r) =>
      setToast({
        message: r.transcriptRemoved
          ? `Deleted ${target} permanently — transcript removed from disk.`
          : `Deleted ${target} from the session list; its transcript was already gone.`,
        variant: 'success',
      }),
    )
    .catch((e: unknown) =>
      setToast({ message: `Delete failed: ${(e as Error).message}`, variant: 'error' }),
    )
}

export function handleRename(
  arg: string,
  currentSessionId: () => string,
  setToast: SetToast,
): void {
  const name = arg.trim()
  if (name.length === 0) {
    setToast({ message: 'Usage: /rename <new name>', variant: 'info' })
    return
  }
  void renameSession(currentSessionId(), name)
    .then(() =>
      setToast({ message: `Renamed the current session to “${name}”.`, variant: 'success' }),
    )
    .catch((e: unknown) =>
      setToast({ message: `Rename failed: ${(e as Error).message}`, variant: 'error' }),
    )
}

/**
 * B-077 — `/memory` reports, `/memory off|on` configures, `/memory forget <n>` removes.
 *
 * It used to report only. A user watching the fact count climb had been told a store exists and
 * where, and given no way to see what was in it or stop it without editing files outside the
 * product.
 */
function memoryStorePath(): string {
  return join(workingDirectory(), '.theokit', 'memory', 'MEMORY.md')
}

function readMemoryStore(): string {
  try {
    return readFileSync(memoryStorePath(), 'utf8')
  } catch {
    // No store yet is the normal first-run state, not an error to raise at someone asking.
    return ''
  }
}

/** B-077 — `/memory off|on`. Restricts only; trust still decides whether memory is possible. */
function toggleMemory(on: boolean, setToast: SetToast): void {
  setMemoryEnabledForSession(on)
  setToast({
    // Says WHEN it applies. The agent is rebuilt per turn, so claiming immediate effect would be
    // wrong for the turn already in flight.
    message: `Memory generation ${on ? 'on' : 'off'} for this session — applies from the next turn. Not persisted; set it in config to make it durable.`,
    variant: 'success',
  })
}

/** B-077 — `/memory forget <n>`, by the number the listing shows. */
function forgetFact(rawIndex: string, setToast: SetToast): void {
  const store = readMemoryStore()
  const n = Number(rawIndex)
  const updated = Number.isInteger(n) ? withFactRemoved(store, n) : undefined
  if (updated === undefined) {
    // Reported, never a silent no-op: writing the file back unchanged and claiming success is the
    // failure `rules/error-handling.md` § 2 forbids.
    setToast({
      message: `no fact ${rawIndex || '(none given)'} — /memory lists them by number`,
      variant: 'error',
    })
    return
  }
  writeFileSync(memoryStorePath(), updated, 'utf8')
  setToast({
    message: `forgot fact ${String(n)} — ${String(memoryFacts(updated).length)} left`,
    variant: 'success',
  })
}

/**
 * What the panel says must be what actually runs.
 *
 * Real memory is the AND of THREE facts, and `chat.ts` is where they meet:
 *
 *     posture.allows.memory && cfg.memory === true && memoryEnabledForSession()
 *
 * This read two of them. With the shipped default `memory: false` it therefore answered `Memory ON`
 * while nothing could be written — measured in the running TUI: the panel named a `MEMORY.md` path,
 * a fact was dictated, and no such file was ever created.
 *
 * Each `false` keeps its own sentence because the remedy differs: trust the directory, set the config
 * key, or flip the session switch. Telling someone `/memory on to resume` when the SWITCH is not what
 * is off sends them to a command that cannot help.
 */
export function memoryHeader(state: {
  trusted: boolean
  configured: boolean
  sessionOn: boolean
}): string {
  if (!state.trusted) {
    return 'Memory OFF — this directory is untrusted (memory writes into the repo).'
  }
  if (!state.configured) {
    return 'Memory OFF — not enabled in config (set `memory = true`) — existing facts are still recalled.'
  }
  if (!state.sessionOn) {
    return 'Memory OFF for this session (/memory on to resume) — existing facts are still recalled.'
  }
  return `Memory ON — ${memoryStorePath()}`
}

/**
 * B-077 — `/memory` lists, `/memory off|on` configures, `/memory forget <n>` removes.
 *
 * It used to report only. A user watching the fact count climb had been told a store exists and
 * where, and given no way to see what was in it or stop it without editing files outside the product.
 */
export function handleMemoryInfo(
  arg: string,
  setToast: SetToast,
  setPanel: SetPanel,
  /** The config factor. Absent ⇒ treated as ON, so a caller that has not been updated keeps its
   *  previous wording rather than silently claiming memory is off. */
  configured = true,
): void {
  const verb = arg.trim().toLowerCase()
  if (verb === 'off' || verb === 'on') return toggleMemory(verb === 'on', setToast)
  if (verb.startsWith('forget')) return forgetFact(verb.slice('forget'.length).trim(), setToast)

  const facts = memoryFacts(readMemoryStore())
  const header = memoryHeader({
    trusted: resolveTrustPosture(workingDirectory()).allows.memory,
    configured,
    sessionOn: memoryEnabledForSession(),
  })
  setPanel({
    title: 'memory',
    body:
      facts.length === 0
        ? `${header}\n\nno facts stored yet — say "Remember: <fact>" to store one`
        : `${header}\n\n${facts.map((f, i) => `  ${String(i + 1)}. ${f}`).join('\n')}\n\n/memory forget <n> removes one`,
  })
}

export function handleCompact(sessionId: string, setToast: SetToast): void {
  void (async () => {
    try {
      const { preTokens, postTokens } = await compactSession(sessionId)
      process.stderr.write(`[compact] pre=${preTokens} post=${postTokens}\n`)
      setToast({
        // #126 — the wording is in `compact-report.ts`, with the measurement that decided it. The
        // previous sentence called this number "context" while the footer used the same word for a
        // different, much larger quantity, and left the two contradicting each other in one frame.
        message: compactReport(preTokens, postTokens),
        variant: 'success',
      })
    } catch (err) {
      setToast({
        message: `/compact failed: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'error',
      })
    }
  })()
}

/**
 * B-087 — `/resume <id>`.
 *
 * Repoints through `setSessionAndPersist`, the SAME seam `backtrack` uses to move after a fork,
 * rather than a second way to switch sessions. B-074 exists because two halves of session
 * management grew separately; a second switch path here would be that again.
 *
 * The session being left is not lost and needs no saving: its transcript is appended continuously
 * and stays listed by `/sessions`. What IS discarded is an unsent composer draft, which is why the
 * message says so instead of leaving the user to notice.
 */
export function handleResume(
  arg: string,
  deps: {
    currentSessionId: () => string
    streaming: boolean
    setSessionAndPersist: (id: string) => void
    setClearEpoch: Dispatch<SetStateAction<number>>
    /**
     * #70 — the screen must SAY the session was resumed.
     *
     * `clearEpoch` empties the transcript and the thread is not repopulated, so what the user sees
     * afterwards is the welcome banner and nothing else — identical to a command that did nothing,
     * while the model demonstrably has the earlier turns. This is the one signal that tells the two
     * apart, and it already existed: it was bound to whether the PROCESS started on a session
     * pointer, so a mid-session `/resume` never reached it.
     */
    setResumed: Dispatch<SetStateAction<boolean>>
    setToast: SetToast
    /**
     * Injected so the SUCCESS path has a test.
     *
     * Without it the only reachable cases are the refusals, and a test suite that covers only the
     * refusals proves nothing about the thing #70 is: whether a real resume tells the user it
     * happened. Mutating the flag away would have left every case green.
     */
    listKnownSessions?: () => Promise<{ agentId: string }[]>
  },
): void {
  void (async () => {
    const known = (await (deps.listKnownSessions ?? listSessions)()).map((s) => s.agentId)
    const plan = planResume({
      arg,
      current: deps.currentSessionId(),
      streaming: deps.streaming,
      known,
    })
    if (plan.kind === 'refused') {
      deps.setToast({ message: plan.reason, variant: 'info' })
      return
    }
    const leaving = deps.currentSessionId()
    deps.setSessionAndPersist(plan.id)
    deps.setResumed(true)
    deps.setClearEpoch((e) => e + 1)
    deps.setToast({
      message: `resumed ${plan.id} — ${leaving} is still listed; any unsent draft was discarded`,
      variant: 'success',
    })
  })()
}
