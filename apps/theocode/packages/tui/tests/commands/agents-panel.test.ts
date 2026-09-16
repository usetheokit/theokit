/**
 * `/agents` — one screen for the two things the word means here.
 *
 * The command used to answer with a toast pointing at `/subagents` and `/sessions`. That is a worse
 * answer than the listing: the person typing `/agents` arrived from Codex and has neither word yet,
 * so they are told to go and type two commands they have just been told about.
 *
 * What the cases below protect is mostly the SEAMS. The panel is a composition — the subagent half
 * is the body `/subagents` renders, the session half is the lines `/sessions` prints — and a
 * composition fails by drifting from its parts, so the drift is asserted directly rather than by
 * re-describing the format here. The rest is the empty and failure states, which are where a
 * listing is most easily read as an answer it is not: "no sessions" and "the store could not be
 * read" send a user to opposite places.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContentPanel, ToastPayload } from '../../src/screen-types.js'
import { agentsPanelBody, handleAgents, subagentsPanelBody } from '../../src/commands/agents-panel.js'
import type { ListedSessions } from '../../src/commands/session-commands.js'
import { subagentDirs } from '../../src/commands/subagent-inventory.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-agents-panel-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function writeSubagent(name: string): void {
  const dir = subagentDirs(cwd)[0] as string
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), '# agent\n')
}

const sessions: ListedSessions = [
  { agentId: 'tui-1', archived: false },
  { agentId: 'tui-2', name: 'nightly', archived: true },
]

describe('the agents panel answers both halves of the question', () => {
  it('test_it_lists_the_project_subagents_and_the_sessions_on_one_screen', () => {
    writeSubagent('reviewer')

    const body = agentsPanelBody(cwd, sessions, 'tui-1')

    expect(body, 'the subagent half is missing').toContain('reviewer')
    expect(body, 'the session half is missing').toContain('tui-2')
  })

  it('test_it_marks_the_session_you_are_in_and_only_that_one', () => {
    const lines = agentsPanelBody(cwd, sessions, 'tui-2').split('\n')

    expect(
      lines.find((l) => l.includes('tui-2')),
      'the current session is unmarked',
    ).toContain('●')
    expect(
      lines.find((l) => l.includes('tui-1')),
      'a session you are not in is marked',
    ).not.toContain('●')
  })

  it('test_a_named_session_still_shows_the_id_that_resume_takes', () => {
    // The listing used to print `name ?? agentId`, so naming a session hid the only handle
    // `/resume`, `/archive` and `/delete` accept. A panel that says `/resume <id>` and then does
    // not show an id is a dead end.
    const body = agentsPanelBody(cwd, sessions, 'tui-1')

    expect(body, 'the id of the renamed session is gone').toContain('tui-2')
    expect(body, 'the name a user gave it is gone').toContain('nightly')
  })

  it('test_it_names_the_commands_that_own_each_half_on_their_own', () => {
    // The command answers a word neither half uses, so it has to hand back the vocabulary — the
    // user who wanted only one of the two lists should leave knowing which command gives it.
    const body = agentsPanelBody(cwd, sessions, 'tui-1')

    expect(body).toContain('/subagents')
    expect(body).toContain('/resume')
  })
})

describe('the agents panel reuses the listings it composes', () => {
  it('test_the_subagent_half_is_exactly_what_subagents_renders', () => {
    // Anti-drift, and the reason `handleListSubagents` was changed to call the same function: two
    // renderers for one inventory disagree first about the empty case, which is the one carrying
    // the directory a user needs.
    writeSubagent('analyst')

    expect(agentsPanelBody(cwd, sessions, 'tui-1')).toContain(subagentsPanelBody(cwd))
  })

  it('test_a_project_with_no_subagents_names_the_directory_rather_than_saying_none', () => {
    const body = agentsPanelBody(cwd, [], 'tui-1')

    // Both paths, because both are read: naming only one sends the operator to a directory that
      // would have worked while hiding the other.
      for (const dir of subagentDirs(cwd)) {
        expect(body, `the path the build actually reads is not shown: ${dir}`).toContain(dir)
      }
  })

  it('test_no_sessions_yet_is_stated_rather_than_left_blank', () => {
    // An empty region under a heading reads as a rendering failure, and the two are worth telling
    // apart: one means "you have not started a second conversation", the other means "we could not
    // look".
    expect(agentsPanelBody(cwd, [], 'tui-1')).toContain('no sessions yet')
  })
})

describe('handleAgents renders one panel, or says why it could not', () => {
  const spies = () => ({ setPanel: vi.fn<(p: ContentPanel) => void>(), setToast: vi.fn() })

  it('test_a_successful_read_renders_a_single_agents_panel', async () => {
    const { setPanel, setToast } = spies()

    handleAgents(
      () => 'tui-1',
      setPanel,
      setToast,
      () => Promise.resolve(sessions),
    )
    await vi.waitFor(() => expect(setPanel).toHaveBeenCalledOnce())

    expect(setPanel.mock.calls[0]?.[0].title).toBe('agents')
    expect(setPanel.mock.calls[0]?.[0].body, 'the store rows never reached the panel').toContain(
      'tui-2',
    )
    expect(setToast, 'a successful listing raised a toast as well').not.toHaveBeenCalled()
  })

  it('test_a_failed_session_read_becomes_an_error_rather_than_an_empty_listing', async () => {
    // The half that can fail goes to the store. Rendering the panel anyway would print "no
    // sessions yet" — the exact opposite of what happened, and unfalsifiable from the screen.
    const { setPanel, setToast } = spies()

    handleAgents(
      () => 'tui-1',
      setPanel,
      setToast,
      () => Promise.reject(new Error('registry gone')),
    )
    await vi.waitFor(() => expect(setToast).toHaveBeenCalledOnce())

    expect(setPanel, 'a panel was rendered from a listing that failed').not.toHaveBeenCalled()
    const toast = setToast.mock.calls[0]?.[0] as ToastPayload
    expect(toast.variant).toBe('error')
    expect(toast.message, 'the failure does not say what went wrong').toContain('registry gone')
  })
})
