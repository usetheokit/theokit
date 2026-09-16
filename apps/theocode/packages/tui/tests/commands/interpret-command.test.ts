/**
 * B-116 slice 2 — `interpretCommand` dispatch: which handler claims which action.
 *
 * The router used to be a chain of responsibility over eight group functions, and the first that
 * returned true won. The obvious thing to test was precedence — and MEASURED, precedence was not
 * observable here: the actions partitioned cleanly across the groups, no action appeared in two, so
 * reordering the chain changed nothing. Three mutations proved it (reordering the chain, removing
 * the early return, making `noop` stop claiming) and none turned a case red.
 *
 * #40 replaced the chain with one `Record<CommandAction['kind'], Handler>` and a single lookup, so
 * the disjointness that made order inert is now the type's job: a kind with no entry does not
 * compile, and a kind claimed twice cannot be written, because a repeated key is the same key. The
 * two cases that asserted the partition by reading this file's sibling source with a regex went
 * with the chain — there are no `case` labels left to parse, and nothing left for them to catch
 * that the compiler does not catch first.
 *
 * What remains is behavioural, and it is the half no type proves: that each action reaches the
 * handler that does the work, and that an unclaimed action is inert — a registry entry added ahead
 * of its handler lands there.
 *
 * The fake supplies every field of `CommandCapabilities` as a spy rather than a partial cast, so a
 * handler reaching for a field the fake forgot fails loudly instead of calling `undefined`.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommandCapabilities } from '../../src/commands/command-capabilities.js'
import { interpretCommand } from '../../src/commands/interpret-command.js'
import { clearWiring, currentWiring, recordWiring } from '../../src/agent-session/wiring-record.js'
import type { CommandAction } from '../../src/commands/registry.js'

/** The collaborators a command may reach through, as opposed to the effects it may cause. */
function stubCollaborators() {
  const agent = { send: vi.fn(), reset: vi.fn(), abort: vi.fn() }
  const SESSION = {
    attachImages: vi.fn(),
    effort: vi.fn(() => 'medium' as never),
    setEffort: vi.fn(),
    cfg: vi.fn(() => ({ modelLabel: 'm', sandboxLabel: 's', sandboxDetail: 'read-only' })),
    sessionModel: vi.fn(() => undefined),
    setSessionModel: vi.fn(),
    setModel: vi.fn(),
    session: vi.fn(() => 'sess-1'),
  }
  const ptyOwner = {
    backend: vi.fn(() => ({ activeSessionCount: () => 0, killAll: vi.fn() })),
  }
  return { agent, SESSION, ptyOwner }
}

/** Every effect a command can cause, one spy each. Wired into the capabilities by name below. */
function stubSpies() {
  return {
    resetSession: vi.fn(),
    setSessionAndPersist: vi.fn(),
    startGoal: vi.fn(),
    exit: vi.fn(),
    setToast: vi.fn(),
    setPanel: vi.fn(),
    setMode: vi.fn(),
    setShowHelp: vi.fn(),
    setShowUsage: vi.fn(),
    setClearEpoch: vi.fn(),
    setEffort: vi.fn(),
    setApprovalMode: vi.fn(),
    setGoalRun: vi.fn(),
    setGoalFeed: vi.fn(),
    // #70 — `/new` and `/clear` clear the continuation flag.
    setResumed: vi.fn(),
    setLoginProvider: vi.fn(),
    setReviewResult: vi.fn(),
    currentSessionId: vi.fn(() => 'sess-1'),
    forkCurrentSession: vi.fn(() => ({ newId: 'sess-2', copied: true })),
    stdoutWrite: vi.fn(),
    // The OTHER stdout seam. Same file descriptor as `stdout`, opposite meaning: this one survives
    // the next repaint and that one does not, so the dispatch test has to be able to tell which
    // of the two a command reached for.
    writeToScrollback: vi.fn(),
  }
}

function harness(over: { hasLastUsage?: boolean } = {}) {
  const { agent, SESSION, ptyOwner } = stubCollaborators()
  const spies = stubSpies()

  const cap = {
    // Spread rather than listed one by one: the previous form named every spy twice, so a new one
    // was easy to add to the record and forget to wire — and an unwired spy never fires, which
    // reads exactly like a command that correctly did nothing.
    ...spies,
    agent,
    SESSION,
    ptyOwner,
    customCommands: new Map(),
    backtrack: { setSeed: vi.fn() as unknown as Dispatch<SetStateAction<string>> },
    goalAbort: { current: null } as MutableRefObject<AbortController | null>,
    lastSentMessage: { current: null } as MutableRefObject<string | null>,
    stdout: { write: spies.stdoutWrite },
    approvalMode: 'on-request',
    goalRun: null,
    goalActive: false,
    events: [],
    streaming: false,
    // #58 — whether the last turn left usage to draw. Default `false`: a fresh session, which is
    // the state `/usage` used to arm an invisible panel from.
    hasLastUsage: over.hasLastUsage ?? false,
  } as unknown as CommandCapabilities

  return { cap, agent, SESSION, ptyOwner, ...spies }
}

// B-168 — the record is process-wide within this file: vitest isolates per FILE, not per test. Before
// this, publishing one at line 155 left 13 tests observing it.
afterEach(() => {
  clearWiring()
})

const run = (action: CommandAction, text = '', h = harness()) => {
  interpretCommand(action, text, h.cap)
  return h
}

describe('interpretCommand — the session-and-screen group claims its actions', () => {
  it('test_new_resets_the_session_and_clears_the_screen', () => {
    // First group in the chain; if a later one ever claimed `new`, the session would not reset.
    const h = run({ kind: 'new' } as CommandAction)

    expect(h.resetSession).toHaveBeenCalled()
    expect(h.agent.reset).toHaveBeenCalled()
    expect(h.stdoutWrite).toHaveBeenCalled()
  })

  it('test_noop_is_claimed_and_does_nothing', () => {
    // `noop` returning true is what stops the chain. If it fell through, a later group's default
    // could act on it — the quietest possible bug.
    const h = run({ kind: 'noop' } as CommandAction)

    expect(h.resetSession).not.toHaveBeenCalled()
    expect(h.setToast).not.toHaveBeenCalled()
    expect(h.agent.send).not.toHaveBeenCalled()
  })

  it('test_usage_before_the_first_turn_says_so_instead_of_toggling_nothing', () => {
    // #58 — the panel renders on `showUsage && lastUsage`, so before any turn the toggle armed a
    // flag with nothing behind it: `/usage` rendered nothing and said nothing. `/copy` answers
    // "nothing to copy — the agent has not replied yet" in the same situation, and that is the
    // shape this follows.
    const h = run({ kind: 'toggleUsage' } as CommandAction, '', harness({ hasLastUsage: false }))

    expect(h.setShowUsage, 'the toggle armed a panel that cannot render').not.toHaveBeenCalled()
    expect(h.setToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('no usage') }),
    )
  })

  it('test_usage_toggles_the_panel_once_a_turn_has_reported_usage', () => {
    // Anti-vacuity floor: refusing unconditionally would satisfy the assertion above.
    const h = run({ kind: 'toggleUsage' } as CommandAction, '', harness({ hasLastUsage: true }))

    expect(h.setShowUsage).toHaveBeenCalled()
    expect(h.setToast).not.toHaveBeenCalled()
  })

  it('test_toggleHelp_reaches_the_help_setter_and_not_the_panel', () => {
    const h = run({ kind: 'toggleHelp' } as CommandAction)

    expect(h.setShowHelp).toHaveBeenCalled()
    expect(h.setPanel).not.toHaveBeenCalled()
  })
})

describe('interpretCommand — later groups claim their own', () => {
  it('test_mode_reaches_the_turn_group', () => {
    const h = run({ kind: 'mode', mode: 'plan' } as unknown as CommandAction)
    expect(h.setMode).toHaveBeenCalled()
  })

  it('test_showStatus_reaches_the_inspection_group', () => {
    // B-161: with no record published, `statusPanel` falls back to reading the rules off disk, so
    // this test's coverage depended on whether the checkout it ran in had `.claude/rules/` — a
    // 248,682-char corpus here, absent in a clean clone, which took the truncation path with it.
    // `recordWiring` is how a real build publishes the record; using it keeps the assertion about
    // routing, which is what this test is for.
    recordWiring({
      agentsMd: { active: [], requested: [], suppressedByTrust: false },
      rules: { count: 0, read: 0 },
    } as never)
    const h = run({ kind: 'showStatus' } as CommandAction)
    expect(h.setPanel).toHaveBeenCalled()
  })

  it('test_send_reaches_the_conduct_group_and_the_agent', () => {
    // Last group in the chain. Reaching it proves nothing earlier swallowed the action.
    const h = run({ kind: 'send', text: 'hello' } as unknown as CommandAction, 'hello')
    expect(h.agent.send).toHaveBeenCalled()
  })
})

describe('interpretCommand — the remaining groups claim their own', () => {
  it('test_fork_reaches_the_identity_group', () => {
    // `identity` sits second in the chain and is the largest group (eight actions). Nothing above
    // covered it, so a first group that started claiming one of these would have gone unseen.
    //
    // `fork` rather than `listSessions` because most of this group reads the session directory
    // asynchronously; a case that awaited that would be testing the filesystem, not the dispatch.
    const h = run({ kind: 'fork' } as CommandAction)
    expect(h.forkCurrentSession).toHaveBeenCalled()
  })

  it('test_listSkills_reaches_the_transcript_group', () => {
    const h = run({ kind: 'listSkills' } as CommandAction)
    expect(h.setPanel).toHaveBeenCalled()
  })

  it('test_showPermissions_reaches_the_settings_group_and_reads_the_sandbox_posture', () => {
    // The group added for the two read-only knobs. It sits after `transcriptOut`, so an earlier
    // group starting to claim either action would send `/permissions` somewhere that cannot read
    // `SESSION.cfg()` — and the panel would render without the half it exists to pair.
    const h = run({ kind: 'showPermissions' } as CommandAction)

    expect(h.setPanel).toHaveBeenCalled()
    expect(
      h.SESSION.cfg,
      'the panel was built without asking for the sandbox mode',
    ).toHaveBeenCalled()
  })

  it('test_theme_reaches_the_settings_group_as_a_toast_and_not_a_panel', () => {
    // A bare `/theme` reports one line, so a bordered panel would overstate it. The assertion pins
    // the shape as much as the routing: a report this small is a toast here, the way `/model` is.
    // The empty argument also keeps this routing test from switching the process-wide session base
    // out from under whatever runs next in this file.
    const h = run({ kind: 'theme', arg: '' } as unknown as CommandAction)

    expect(h.setToast).toHaveBeenCalled()
    expect(h.setPanel).not.toHaveBeenCalled()
  })

  it('test_title_and_statusline_reach_the_settings_group', () => {
    // Both joined `settings` rather than opening groups of their own, which put that switch at four
    // arms. The bare form is used deliberately: it reports, so this routing case cannot leave a
    // process-wide selection changed under whatever runs next in this file.
    //
    // The panel is the assertion because the group is typed by `SettingsCapabilities`, which is
    // deliberately narrow — a handler routed there without `setPanel` in that pick would throw at
    // destructuring rather than quietly reporting nowhere.
    for (const kind of ['title', 'statusline']) {
      const h = run({ kind, arg: '' } as unknown as CommandAction)

      expect(h.setPanel, `/${kind} did not reach a handler`).toHaveBeenCalled()
    }
  })

  it('test_raw_reaches_the_transcript_group_and_writes_above_the_frame', () => {
    // The seam is the assertion. `/raw` writing to `stdout` instead would be erased by the next
    // repaint — the command would look like it did nothing, and no other test in this file
    // distinguishes the two writers.
    const h = harness()
    interpretCommand({ kind: 'raw', arg: '' } as unknown as CommandAction, '', {
      ...h.cap,
      events: [{ kind: 'message', role: 'assistant', text: 'answer' }],
    } as CommandCapabilities)

    expect(h.writeToScrollback, '/raw never reached the scrollback writer').toHaveBeenCalled()
    expect(
      h.stdoutWrite,
      '/raw wrote to the raw stream, where the next repaint erases it',
    ).not.toHaveBeenCalled()
  })

  it('test_listPtys_reaches_the_shells_group', () => {
    // The smallest group, and the one most likely to be dropped from the chain unnoticed: two
    // actions, both about background shells nobody looks at until one is stuck.
    const h = run({ kind: 'listPtys' } as CommandAction)
    expect(h.ptyOwner.backend).toHaveBeenCalled()
    expect(h.setToast).toHaveBeenCalled()
  })
})

/**
 * The refusal that IS reachable synchronously, asserted through dispatch.
 *
 * It is already tested where it is implemented (`send-message.test.ts`), and that is the right place
 * for the message and the branch. What that file cannot show is that the refusal is REACHABLE: a
 * router that stopped passing `goalActive`, or claimed `send` in an earlier group, would leave it
 * green while the guard never ran.
 *
 * The sibling refusal — resuming a session while a turn streams — is NOT asserted here, deliberately.
 * `handleResume` reads the session directory before it can decide, so reaching the guard through the
 * router means either mocking the filesystem or awaiting a real read, and a case that awaits disk to
 * prove a routing decision is a flaky test wearing a routing test's name. The guard itself is proven
 * against the pure planner in `resume-command.test.ts`, which is the shape this subsystem's own
 * acceptance criteria ask for. Recorded rather than papered over: the routing half of that one is a
 * known gap.
 */
describe('interpretCommand — the refusal survives the trip through the router', () => {
  it('test_a_send_while_a_goal_runs_is_refused_rather_than_sent', () => {
    const h = harness()
    interpretCommand({ kind: 'send', text: 'hello' } as unknown as CommandAction, 'hello', {
      ...h.cap,
      goalActive: true,
    } as CommandCapabilities)

    expect(
      h.agent.send,
      'the message went to the agent while a goal was running — the router did not carry the flag',
    ).not.toHaveBeenCalled()
    expect(h.setToast).toHaveBeenCalled()
  })

  it('test_a_send_with_no_goal_running_does_reach_the_agent', () => {
    // Anti-vacuity for the refusal above: a router that never sent anything would pass it.
    expect(
      run({ kind: 'send', text: 'hello' } as unknown as CommandAction, 'hello').agent.send,
    ).toHaveBeenCalled()
  })
})

describe('interpretCommand — an unclaimed action falls through without effect', () => {
  it('test_an_unknown_action_touches_nothing', () => {
    // The chain returning nothing must be inert, not a crash and not a silent partial effect. A
    // registry entry added without a handler lands here.
    const h = harness()

    expect(() =>
      interpretCommand({ kind: '__not_a_command__' } as unknown as CommandAction, '', h.cap),
    ).not.toThrow()
    expect(h.resetSession).not.toHaveBeenCalled()
    expect(h.setToast).not.toHaveBeenCalled()
    expect(h.agent.send).not.toHaveBeenCalled()
    expect(h.setPanel).not.toHaveBeenCalled()
  })
})

describe('B-168 — a published record does not decide what the next test sees', () => {
  // The pair is anti-vacuous and order-independent, and the first version was neither: removing the
  // publish left it green with nothing to guard, and its correctness depended on sitting below
  // another test — under `--sequence.shuffle` the mutant survived on 5 of 12 seeds. Publishing HERE
  // makes the pair prove both halves on its own, wherever the file runs it.
  //
  // It was also nested inside the describe above by accident, which the reporter path showed.
  it('test_publishing_a_record_is_observable', () => {
    recordWiring({
      agentsMd: { active: [], requested: [], suppressedByTrust: false },
      rules: { count: 0, read: 0 },
    } as never)

    expect(currentWiring(), 'the publisher stopped publishing, so the test below guards nothing').toBeDefined()
  })

  it('test_the_record_is_cleared_between_tests_in_this_file', () => {
    // `.toBeUndefined()` rather than `.toBeFalsy()`: a `clearWiring` that set `null` would pass the
    // looser assertion, and that is the mutant most likely to be written by accident.
    expect(currentWiring(), 'the wiring record leaked from the test above').toBeUndefined()
  })
})
