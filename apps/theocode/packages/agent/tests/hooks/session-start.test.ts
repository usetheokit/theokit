/**
 * `SessionStart` fires ONCE, when this product's session begins — not through the framework.
 *
 * ## Why it is not the framework's `on_session_start`
 *
 * `build-handlers.ts` used to map it there, and the event never ran. Measured across two sessions:
 * the framework converts the map into a plugin and invokes what is registered — proven by a
 * two-registration experiment (a `.hooks()` handler and a `.plugins()` handler, same turn, counted
 * per label: both fired, 3 of 3, negative control 0). Registration was never the problem.
 *
 * The problem is what the two names MEAN. `on_session_start` fires once per **loop context**, and
 * this product builds a new agent module **per turn** (`chat-transport.ts` calls `buildChatAgent`
 * inside `run(input)`). So honouring the mapping literally would run a `SessionStart` hook on
 * **every user message** — worse than not running it, because that is precisely the hook an author
 * writes assuming it happens once. `@theokit/sdk` now documents the cadence on the public type and
 * names this architecture as the case where it bites.
 *
 * A session is this product's own concept — the surfaces mint the id — so the surfaces fire it.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as frameworkHooks from '@theokit/agents/hooks'

// Wrap, don't replace: the real runner still runs, and the spy can see whether it was called.
vi.mock('@theokit/agents/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/agents/hooks')>()
  return { ...actual, runHostHooks: vi.fn(actual.runHostHooks) }
})

import { runSessionStartHooks, sessionStartSpecs } from '../../src/hooks/session-start.js'
import type { HookSpec } from '../../src/hooks/hooks-spec.js'

let cwd: string
let marker: string

const spec = (command: string, event = 'SessionStart'): HookSpec =>
  ({ event, command, timeout_ms: 5_000 }) as HookSpec

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-sessionstart-'))
  marker = join(cwd, 'fired.txt')
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

const lines = (): string[] =>
  existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean) : []

describe('running the hook', () => {
  it('test_a_session_start_hook_runs', async () => {
    await runSessionStartHooks({
      specs: [spec(`echo START >> ${marker}`)],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
    })

    expect(lines()).toEqual(['START'])
  })

  it('test_it_runs_once_per_call_not_once_per_turn', async () => {
    // The whole reason this exists. The framework's event fires per loop context, and this product
    // builds an agent per turn — so mapping it there would run this on every message.
    const opts = {
      specs: [spec(`echo START >> ${marker}`)],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
    }
    await runSessionStartHooks(opts)

    expect(lines()).toEqual(['START'])
  })

  it('test_only_SessionStart_specs_run', async () => {
    // Anti-vacuity floor, and the contract: this function is not a hook engine. Every other event
    // still belongs to the framework, and running one here would double-fire it.
    await runSessionStartHooks({
      specs: [spec(`echo STOP >> ${marker}`, 'Stop'), spec(`echo START >> ${marker}`)],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
    })

    expect(lines()).toEqual(['START'])
  })

  it('test_an_unapproved_hook_does_not_run', async () => {
    // The fingerprint gate is the whole security model for hooks — a command in a file that arrived
    // with a clone. Firing at the surface must not become a way around it.
    const warns: string[] = []
    await runSessionStartHooks({
      specs: [spec(`echo START >> ${marker}`)],
      cwd,
      sessionId: 'tui-1',
      approved: () => false,
      onWarn: (m) => warns.push(m),
    })

    expect(lines()).toEqual([])
    expect(warns.join(' ')).toContain('not approved')
  })

  it('test_a_failing_hook_is_reported_and_does_not_throw', async () => {
    // A SessionStart hook runs before the operator has typed anything. Throwing here would refuse
    // the session over a hook, which is a larger punishment than the failure warrants.
    const warns: string[] = []
    await runSessionStartHooks({
      specs: [spec('exit 3')],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
      onWarn: (m) => warns.push(m),
    })

    expect(warns.join(' ')).toContain('exit 3')
  })

  it('test_the_project_dir_reaches_the_command_without_touching_process_env', async () => {
    const before = process.env.CLAUDE_PROJECT_DIR
    delete process.env.CLAUDE_PROJECT_DIR
    try {
      await runSessionStartHooks({
        specs: [spec(`printenv CLAUDE_PROJECT_DIR >> ${marker}`)],
        cwd,
        sessionId: 'tui-abc',
        approved: () => true,
      })
      expect(lines()).toEqual([cwd])
      expect(process.env.CLAUDE_PROJECT_DIR).toBeUndefined()
    } finally {
      if (before !== undefined) process.env.CLAUDE_PROJECT_DIR = before
    }
  })

  it('test_the_session_id_reaches_the_command', async () => {
    // Without it the hook cannot tell which session it is starting, which is most of what a
    // SessionStart hook is for.
    await runSessionStartHooks({
      specs: [spec(`printenv THEOCODE_SESSION_ID >> ${marker}`)],
      cwd,
      sessionId: 'tui-abc',
      approved: () => true,
    })

    expect(lines()).toEqual(['tui-abc'])
  })

  it('test_no_session_start_specs_runs_nothing_and_says_nothing', async () => {
    const warns: string[] = []
    await runSessionStartHooks({
      specs: [spec(`echo STOP >> ${marker}`, 'Stop')],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
      onWarn: (m) => warns.push(m),
    })

    expect(lines()).toEqual([])
    expect(warns).toEqual([])
  })
})

describe('the framework must not also deliver it', () => {
  it('test_a_SessionStart_spec_produces_no_framework_handler', async () => {
    // The collision this prevents. If the surface fires it AND the map still points it at
    // `on_session_start`, then the day the framework's cadence changes — or an agent stops being
    // rebuilt per turn — the hook runs twice. A hook is arbitrary shell; twice is not cosmetic.
    // Same reasoning that keeps `.claude/settings.json` hooks untranslated in `settings-json.ts`.
    const { buildHookHandlers } = await import('../../src/hooks/build-handlers.js')
    const APPROVE_ALL = { has: () => true } as unknown as ReadonlySet<string>
    const handlers = buildHookHandlers(
      [
        { event: 'SessionStart', command: 'a.sh', timeout_ms: 5_000 },
        { event: 'Stop', command: 'b.sh', timeout_ms: 5_000 },
      ] as HookSpec[],
      { trusted: true, approved: APPROVE_ALL },
    ) as unknown as Record<string, unknown>

    const keys = Reflect.ownKeys(handlers)
      .map(String)
      .filter((k) => typeof handlers[k] === 'function')

    expect(keys).not.toContain('on_session_start')
    // The positive control: without it, a build that dropped EVERY handler would pass the line above.
    expect(keys).toContain('post_assistant_reply')
  })
})

describe('the seam the surfaces call', () => {
  it('test_an_untrusted_directory_runs_nothing', () => {
    // Same gate as every other hook: an untrusted directory's hooks do not run. Firing at the
    // surface must not become a second door into the one `projectSourceAllowed` guards.
    expect(
      sessionStartSpecs({
        trusted: false,
        hooks: [{ event: 'SessionStart', command: 'a.sh' }],
      }),
    ).toEqual([])
  })

  it('test_a_trusted_directory_yields_the_specs', () => {
    // Positive control for the arm above.
    expect(
      sessionStartSpecs({
        trusted: true,
        hooks: [{ event: 'SessionStart', command: 'a.sh' }],
      }),
    ).toHaveLength(1)
  })

  it('test_a_malformed_hooks_block_yields_nothing_rather_than_throwing', () => {
    // A parse failure here would refuse the session before the operator typed anything. The
    // parse error is already surfaced by the path that builds the framework handlers.
    expect(sessionStartSpecs({ trusted: true, hooks: [{ nonsense: true }] })).toEqual([])
  })
})

describe('the framework runner is the one that runs it', () => {
  it('test_session_start_goes_through_runHostHooks_with_the_framework_event', async () => {
    // Fails if the surface goes back to running the command itself: the spy sees no call.
    const spy = vi.mocked(frameworkHooks.runHostHooks)
    spy.mockClear()
    try {
      await runSessionStartHooks({
        specs: [spec(`echo START >> ${marker}`)],
        cwd,
        sessionId: 'tui-1',
        approved: () => true,
      })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[0]).toBe('on_session_start')
      expect(lines()).toEqual(['START'])
    } finally {
      spy.mockClear()
    }
  })

  it('test_an_unapproved_spec_never_reaches_runHostHooks', async () => {
    const spy = vi.mocked(frameworkHooks.runHostHooks)
    spy.mockClear()
    try {
      await runSessionStartHooks({
        specs: [spec(`echo START >> ${marker}`)],
        cwd,
        sessionId: 'tui-1',
        approved: () => false,
        onWarn: () => undefined,
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockClear()
    }
  })

  it('test_a_hook_killed_by_a_signal_keeps_its_stderr_in_the_warning', async () => {
    const warns: string[] = []
    await runSessionStartHooks({
      specs: [spec('echo diagnostic-from-hook >&2; kill -TERM $$')],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
      onWarn: (m) => warns.push(m),
    })
    expect(warns.join(' ')).toContain('could not run')
    expect(warns.join(' ')).toContain('diagnostic-from-hook')
  })

  it('test_an_error_the_framework_caught_keeps_its_message_in_the_warning', async () => {
    vi.mocked(frameworkHooks.runHostHooks).mockImplementationOnce(async (_e, specs, options) => {
      options.onWarn?.('hook "x" on on_session_start failed: spawn EBOOM')
      return [{ spec: specs[0] as never, status: 'failed' }]
    })
    const warns: string[] = []
    await runSessionStartHooks({
      specs: [spec('true')],
      cwd,
      sessionId: 'tui-1',
      approved: () => true,
      onWarn: (m) => warns.push(m),
    })
    expect(warns.join(' ')).toContain('spawn EBOOM')
  })
})
