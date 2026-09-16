/**
 * B-075 — the two commands that move a conversation OUT of the terminal.
 *
 * Their own module: `command-content.ts` is the panels-and-toasts file and these two do I/O
 * (clipboard, filesystem). Both read the TIMELINE, never the rendered frame — the frame is
 * hard-wrapped to a bordered box, which re-flows the code an answer usually contains.
 */
import type { Dispatch, SetStateAction } from 'react'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { ContentPanel, ToastPayload } from '../screen-types.js'
import { workingDirectory } from '../working-directory.js'
import { copyToClipboard } from '../clipboard/clipboard.js'
import { conversationToMarkdown, lastAssistantText } from '../transcript-export.js'
import { subagentsPanelBody } from './agents-panel.js'
import { hooksPanelBody, mcpPanelBody, skillsPanelBody } from './wiring-panels.js'
import { currentMcpFailures } from '../agent-session/mcp-failure-record.js'
import { currentWiring } from '../agent-session/wiring-record.js'
import {
  armLoosening,
  clearArmed,
  isLoosening,
  parseSandboxMode,
  takeArmed,
} from './sandbox-command.js'
import { SANDBOX_MODES } from '@theocode/agent/config'
import { setSandboxModeForSession } from '@theocode/agent'

type SetToast = Dispatch<SetStateAction<ToastPayload | null>>

export function handleCopy(events: readonly unknown[], setToast: SetToast): void {
  const text = lastAssistantText(events)
  if (text === undefined) {
    setToast({ message: 'nothing to copy — the agent has not replied yet', variant: 'info' })
    return
  }
  try {
    const { bin } = copyToClipboard(text)
    setToast({ message: `copied the last reply (${bin})`, variant: 'success' })
  } catch (e: unknown) {
    // Reported, never swallowed: a copy that silently did nothing is discovered when the user
    // pastes. The typed error already names /export as the way out.
    setToast({ message: (e as Error).message, variant: 'error' })
  }
}

export function handleExport(
  arg: string,
  events: readonly unknown[],
  currentSessionId: () => string,
  setToast: SetToast,
): void {
  const markdown = conversationToMarkdown(events)
  if (markdown.length === 0) {
    setToast({ message: 'nothing to export — this conversation is empty', variant: 'info' })
    return
  }
  const name = arg.trim()
  const target =
    name.length > 0
      ? resolve(workingDirectory(), name)
      : join(workingDirectory(), `${currentSessionId()}.md`)
  try {
    // `wx` so an export never overwrites: the path may be a file the user cares about, and this
    // command is not the place to discover that.
    writeFileSync(target, `${markdown}\n`, { encoding: 'utf8', flag: 'wx' })
    setToast({ message: `wrote ${target}`, variant: 'success' })
  } catch (e: unknown) {
    const detail =
      (e as NodeJS.ErrnoException).code === 'EEXIST'
        ? `${target} already exists — pass another path`
        : (e as Error).message
    setToast({ message: `export failed: ${detail}`, variant: 'error' })
  }
}

/**
 * B-072 — the subagent inventory, rendered.
 *
 * Lives beside the transcript commands because both answer "what is here?" without starting a turn.
 *
 * The body is rendered by `agents-panel.ts`, because `/agents` prints this same listing above the
 * sessions. Two renderers for one inventory would eventually disagree about the empty case, which
 * is the one carrying the directory a user needs.
 */
export function handleListSubagents(setPanel: (p: ContentPanel) => void): void {
  setPanel({ title: 'subagents', body: subagentsPanelBody(workingDirectory()) })
}

/**
 * B-071 — the hook inventory, from the BUILD RECORD.
 *
 * This replaced a version that re-read the config, which is why the item was reopened: its own DoD
 * says "the listing comes from what was actually wired, not from re-reading the config file — those
 * two can disagree, and the disagreement is the bug worth catching." A re-read cannot detect that
 * disagreement by construction, because it IS the config.
 */
export function handleListHooks(setPanel: (p: ContentPanel) => void): void {
  setPanel({ title: 'hooks', body: hooksPanelBody(currentWiring()) })
}

/** B-070 — the skills the LAST BUILD loaded, never a re-read of config. */
export function handleListSkills(setPanel: (p: ContentPanel) => void): void {
  setPanel({ title: 'skills', body: skillsPanelBody(currentWiring()) })
}

/** B-069 — the MCP servers the LAST BUILD started, never a re-read of `.mcp.json`. */
export function handleListMcp(setPanel: (p: ContentPanel) => void): void {
  // B-088 — the failures the current turn observed, read at OPEN time rather than captured when
  // the panel was built: a user opens /mcp precisely after something looked wrong.
  setPanel({ title: 'mcp servers', body: mcpPanelBody(currentWiring(), currentMcpFailures()) })
}

/**
 * B-076 — `/sandbox [mode]`, and `/sandbox confirm` for a loosening.
 *
 * The change reaches LIVE PTYs because the agent is rebuilt each turn and `resolveInteractiveBackend`
 * calls `sessionPty.setMode(cfg.sandbox_mode)` on the resolved config — which now carries the
 * session override. B-014 is the regression test for that path and stays the proof.
 */
export function handleSandbox(
  arg: string,
  current: () => string,
  setToast: (t: ToastPayload) => void,
): void {
  const raw = arg.trim().toLowerCase()
  if (raw.length === 0) {
    clearArmed()
    setToast({
      message: `sandbox: ${current()} — /sandbox <${SANDBOX_MODES.join(' | ')}>`,
      variant: 'info',
    })
    return
  }
  if (raw === 'confirm') {
    const mode = takeArmed()
    if (mode === undefined) {
      setToast({ message: 'nothing to confirm — /sandbox <mode> first', variant: 'info' })
      return
    }
    setSandboxModeForSession(mode)
    setToast({ message: `sandbox: ${mode} — applies from the next turn`, variant: 'success' })
    return
  }
  const mode = parseSandboxMode(raw)
  if (mode === null) {
    clearArmed()
    setToast({
      message: `unknown sandbox mode "${arg.trim()}" — use ${SANDBOX_MODES.join(' | ')}`,
      variant: 'error',
    })
    return
  }
  const from = parseSandboxMode(current())
  if (from !== null && isLoosening(from, mode)) {
    armLoosening(mode)
    setToast({
      message: `${mode} gives the agent MORE of your disk than ${from}. /sandbox confirm to apply.`,
      variant: 'error',
    })
    return
  }
  clearArmed()
  setSandboxModeForSession(mode)
  setToast({ message: `sandbox: ${mode} — applies from the next turn`, variant: 'success' })
}
