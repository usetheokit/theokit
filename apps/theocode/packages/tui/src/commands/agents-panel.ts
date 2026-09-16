/**
 * `/agents` — the two things "an agent" can mean here, answered on one screen.
 *
 * Codex's `/agents` views and switches active agent sessions. Split across this build, that is two
 * questions with two commands: `/subagents` lists what the project DEFINES, `/sessions` lists the
 * conversations that EXIST. Someone typing `/agents` has neither word yet, and being told to go
 * read two other listings is a worse answer than the listing itself — so this renders both.
 *
 * It composes the existing renderers rather than formatting either listing again. `/subagents` and
 * this panel print the subagent half from `subagentsPanelBody`, `/sessions` and this panel print
 * the session half from `sessionListLines`. A second formatter for a listing is how two screens
 * come to disagree about which session is the current one.
 */
import { listSessions } from '@theocode/agent/session'

import type { ContentPanel, ToastPayload } from '../screen-types.js'
import { workingDirectory } from '../working-directory.js'
import { sessionListLines, type ListedSessions } from './session-commands.js'
import { listSubagents, subagentDirs } from './subagent-inventory.js'

/**
 * The subagent listing, as both `/subagents` and `/agents` print it.
 *
 * The empty case names the DIRECTORY rather than saying "none": a user who defined agents somewhere
 * else needs the path this build actually reads, which is the same one the custom-command router
 * resolves against.
 */
export function subagentsPanelBody(cwd: string): string {
  const names = listSubagents(cwd)
  return names.length === 0
    ? `no subagents in ${subagentDirs(cwd).join(' or ')} — a custom command naming one will run in the main context instead`
    : names.map((name) => `  ${name}`).join('\n')
}

/**
 * Both halves, each under a heading that says which command owns it on its own.
 *
 * The headings are not decoration: this panel answers a word neither of those commands uses, so it
 * has to hand back the vocabulary — someone who wanted only the sessions should leave knowing that
 * `/sessions` exists.
 */
export function agentsPanelBody(
  cwd: string,
  sessions: ListedSessions,
  currentSessionId: string,
): string {
  return [
    'subagents — what this project defines (/subagents)',
    subagentsPanelBody(cwd),
    '',
    'sessions — the conversations you can /resume <id> (● is this one)',
    sessions.length === 0
      ? '  no sessions yet — this one is the first'
      : sessionListLines(sessions, currentSessionId),
  ].join('\n')
}

/**
 * `/agents`, wired to the real session store.
 *
 * The store read is injectable for the reason `agentsMdRow` takes its walk: with only the ambient
 * one the outcome depends on which sessions the machine running the suite happens to have on disk,
 * and every assertion about the rendered listing would be unassertable on half of them.
 *
 * A failed read becomes a toast rather than a panel of half-truths. The session half is the one
 * that can fail — it goes to the store — and a panel that silently dropped it would read as "you
 * have no sessions", which is the opposite of what happened.
 */
export function handleAgents(
  currentSessionId: () => string,
  setPanel: (panel: ContentPanel) => void,
  setToast: (toast: ToastPayload) => void,
  sessions: () => Promise<ListedSessions> = listSessions,
): void {
  void sessions()
    .then((found) => {
      setPanel({
        title: 'agents',
        body: agentsPanelBody(workingDirectory(), found, currentSessionId()),
      })
    })
    .catch((e: unknown) => {
      setToast({
        message: `could not read the session list: ${(e as Error).message} — /subagents still works`,
        variant: 'error',
      })
    })
}
