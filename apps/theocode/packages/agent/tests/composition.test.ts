/**
 * B-061 — what an agent is composed of is asserted, not assumed.
 *
 * This repository builds three agents through three routines that do not call one another
 * (B-059): `buildChatAgent` (`chat.ts:42`), `createReviewAgent` (`review/create-agent.ts:54`)
 * and `buildRoleAgent` (`delegation/roles.ts:138`). Between them they decide which tools exist,
 * which of those are approval-gated, which disk entities the trust posture admits, and what the
 * sandbox confines.
 *
 * Before this file, nothing in the suite read any of it. A change that dropped an approval or
 * widened a tool scope turned nothing red — 268 tests passed either way — which made the green
 * suite evidence about everything in this package EXCEPT the decisions with the largest blast
 * radius in it.
 *
 * The assertions are on the COMPILED definition, not on the call chain that produced it, so they
 * survive B-059 rewriting how the composition is expressed. `.build()` is a pure compile boundary
 * (no API key, no network); the framework's `./testing` stream seam is for driving a RUN and is
 * deliberately not used here — there is no run to drive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tempRoot } from './helpers/temp-root.js'

/**
 * B-161 — HOME is isolated here for the same reason `cwd` is: `buildChatAgent` reads the operator's
 * root at `chat.ts:148` and `:237`, and the assertions below compare `agent.skills` against an EXACT
 * list. An operator with a skill in `~/.theokit/skills/` therefore turns `[]` into `['their-skill']`
 * and reddens two trust tests on their machine and nowhere else — reproduced with a single file.
 *
 * Loading the operator's own skill for an untrusted PROJECT is correct: the assertion messages are
 * about what "an untrusted repo" contributed, and the operator's root is not the repo. What was
 * wrong is the instrument — an exact-list assertion cannot tell the two origins apart, so it reads
 * an operator's ordinary setup as a gate failure.
 */
const realHome = process.env.HOME

beforeEach(() => {
  process.env.HOME = tempRoot('composition-home-')
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
})

// Every import of a module under test is DYNAMIC and inside the test body. `vi.mock` is hoisted
// above the import section, so a static import here evaluates `./config/index.js` — and therefore
// the mock factory — before the `vi.fn()` consts below exist. That is a ReferenceError at collect
// time, not a test failure, so it takes the whole file down. `chat-cwd.test.ts` avoids it the same
// way.

const TRUSTED = {
  level: 'trusted',
  source: 'store',
  allows: {
    projectConfig: true,
    agentsMd: true,
    hooks: true,
    memory: true,
    mcp: true,
    skills: true,
    subagents: true,
    customCommands: true,
  },
}

const UNTRUSTED = {
  level: 'untrusted',
  source: 'store',
  allows: {
    projectConfig: false,
    agentsMd: false,
    hooks: false,
    memory: false,
    mcp: false,
    skills: false,
    subagents: false,
    customCommands: false,
  },
}

function config(sandbox_mode: string) {
  return {
    sandbox_mode,
    approval_policy: 'on-request',
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
    hooks: [],
    skills: ['code-review'],
    // Off, as `DEFAULTS` has it. The fixture used to omit the key entirely, which is how a gate
    // that yields `undefined` instead of `false` reached a test suite unnoticed.
    memory: false,
    declaredWindow: undefined,
    contextWindow: { window: 1000 },
    sandboxPosture: { enforced: true, detail: 'test', mode: sandbox_mode },
  }
}

const resolveTrustPosture = vi.fn(() => TRUSTED)
const resolveEffectiveConfig = vi.fn(() => config('workspace-write'))

vi.mock('../src/config/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveTrustPosture,
  resolveEffectiveConfig,
}))

/**
 * `loadMcpJson` must return something NON-EMPTY or the MCP assertion below is vacuous.
 *
 * Measured: with the real loader pointed at a directory that has no `.mcp.json`, the trust gate
 * and no trust gate produce the identical empty map — a mutation removing the gate entirely
 * survived the first version of this file. The gate has to be the reason the map is empty, not
 * the filesystem.
 */
/**
 * #72 — keyed by DIRECTORY, because there are two scopes now and only one of them is gated.
 *
 * A mock that answered the same for every directory would let the repository's server pass as the
 * operator's and report the gate as working when it was not. The project directory is the one the
 * assertions below are about; the operator's home deliberately declares nothing here, so that this
 * file keeps testing the trust gate and `mcp-scopes.test.ts` keeps testing the merge.
 */
const loadMcpJson = vi.fn((dir: string) =>
  dir === '/p' ? { 'some-server': { command: 'node', args: ['evil.js'] } } : {},
)

/** What the project's `.theokit/agents/` declares in these tests. */
const PROJECT_ROLES = {
  explorer: { tools: ['read_file', 'grep', 'list_dir'] },
  worker: { tools: ['read_file', 'apply_patch', 'run_shell'] },
}

/** What the operator's own `~/.theokit/agents/` declares. Empty unless a test fills it. */
let operatorRoles: Record<string, unknown> = {}

/**
 * The disk boundary path 3 reads. Mocked so the role's declared tool set is the test's input.
 *
 * It HONOURS `settingSources`, because that is the mechanism under test: production passes `[]`
 * for an untrusted directory and the real loader then finds nothing. A mock that returned the
 * roles regardless would make the untrusted assertion below pass for the wrong reason — it would
 * be asserting that some later validation happened to throw, not that the gate closed.
 *
 * It also honours `cwd`, and that half was added after this mock started lying. #65 made
 * `discoverRoles` call this function TWICE — once for the project and once for the operator's home,
 * both with `settingSources: ['project']`, because that token selects the `<cwd>/.theokit/agents`
 * LAYOUT and the layout is the same in both roots. A mock keyed only on the sources answered the
 * home call with the project's roles, and the untrusted assertion below started passing an
 * untrusted repository's definition off as the operator's own. The real loader keys on the
 * directory; so does this now.
 */
const discoverSubagents = vi.fn((cwd: string, opts: { settingSources: string[] }) =>
  Promise.resolve(
    cwd === '/p' ? (opts.settingSources.includes('project') ? PROJECT_ROLES : {}) : operatorRoles,
  ),
)

vi.mock('@theokit/agents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadMcpJson,
  discoverSubagents,
}))

/** The compiled shape `AgentBuilder.build()` returns — only the members this file asserts on. */
interface CompiledAgent {
  tools: { name: string }[]
  approvals: Record<string, { question: string }>
  mcpServers: Record<string, unknown>
  skills: string[]
  settingSources: { user?: boolean; project?: { trustedBy: unknown } }
  memory: { enabled: boolean }
  model: string
}

async function compile(overrides: Record<string, unknown>): Promise<CompiledAgent> {
  const { buildChatAgent } = await import('../src/chat/chat.js')
  return buildChatAgent(overrides as never) as unknown as CompiledAgent
}

const namesOf = (a: CompiledAgent): string[] => a.tools.map((t) => t.name)

describe('path 1 — buildChatAgent composes the coding agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveTrustPosture.mockReturnValue(TRUSTED)
    resolveEffectiveConfig.mockReturnValue(config('workspace-write'))
  })

  it('test_every_approval_key_names_a_tool_the_agent_actually_has', async () => {
    // The framework fail-fasts when the approval map references an unregistered tool
    // (`chat.ts:274`), so a drift here is a crash at agent construction rather than a silent
    // ungated tool — but the crash happens in the user's terminal, not in CI.
    const agent = await compile({ surface: 'headless', cwd: '/p' })
    const tools = new Set(namesOf(agent))

    for (const gated of Object.keys(agent.approvals)) {
      expect(
        tools.has(gated),
        `"${gated}" is approval-gated but is not among the agent's tools — the framework refuses ` +
          'this map at construction, so the agent would fail to start',
      ).toBe(true)
    }
  })

  it('test_read_only_removes_the_write_tools_rather_than_denying_them_later', async () => {
    // Codex parity, stated at `chat.ts:434-436`: read-only removes the CAPABILITY. A build that
    // kept the tool and relied on the approval card to stop it would be one veto away from a write.
    resolveEffectiveConfig.mockReturnValue(config('read-only'))
    const agent = await compile({ surface: 'headless', cwd: '/p' })
    const names = namesOf(agent)

    for (const write of ['apply_patch', 'edit_file', 'delegate_to_team']) {
      expect(names, `read-only still granted "${write}"`).not.toContain(write)
      expect(
        Object.keys(agent.approvals),
        `read-only left an approval entry for "${write}", which the framework rejects because the ` +
          'tool is not registered',
      ).not.toContain(write)
    }
  })

  it('test_workspace_write_grants_the_write_tools_and_gates_every_one_of_them', async () => {
    const agent = await compile({ surface: 'headless', cwd: '/p' })
    const names = namesOf(agent)

    for (const write of ['apply_patch', 'edit_file', 'delegate_to_team']) {
      expect(names, `workspace-write did not grant "${write}"`).toContain(write)
      expect(
        Object.keys(agent.approvals),
        `"${write}" mutates the user's disk (or delegates the authority to) and reached the model ` +
          'without an approval gate',
      ).toContain(write)
    }
  })

  it('test_every_command_executing_tool_is_gated', async () => {
    // The narrowest statement of the product's core promise: nothing runs on the user's machine
    // without them saying yes.
    const agent = await compile({ surface: 'headless', cwd: '/p' })
    const gated = new Set(Object.keys(agent.approvals))

    for (const executes of ['run_shell', 'interactive_shell', 'write_stdin']) {
      expect(
        gated.has(executes),
        `"${executes}" executes commands on the user's machine and is not approval-gated`,
      ).toBe(true)
    }
  })
})

/**
 * What the agent DECLARES, and what each declaration costs.
 *
 * Measured 2026-08-25 by instrumenting `fetch`: the tool schemas are re-sent on every round of a
 * turn and cost MORE than the system prompt (15 115 characters against 10 146). That makes the
 * declared set a budget, not just a capability list, and a tool that cannot work is not a harmless
 * extra — it is a fixed toll on every round plus a round the model can waste choosing it.
 *
 * These tests pin the two decisions that follow from that measurement. They assert on the COMPILED
 * definition, so they survive a rewrite of how the chain expresses them.
 */
describe('path 1 — buildChatAgent declares only what it can actually use', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resolveTrustPosture.mockReturnValue(TRUSTED)
    resolveEffectiveConfig.mockReturnValue(config('workspace-write'))
  })

  it('test_web_search_is_withheld_when_no_provider_is_configured', async () => {
    // `createGenericHttpSearchAdapter` returns `[]` when unconfigured and never throws, so the tool
    // was declared (761 characters/round, measured), approval-gated, and able to return only
    // nothing. The model paid for it every round and the user was asked to approve a search that
    // had nothing to search.
    vi.stubEnv('THEOKIT_SEARCH_API_URL', '')
    const agent = await compile({ surface: 'headless', cwd: '/p' })
    const names = namesOf(agent)

    expect(
      names,
      'web_search reached the model with no provider behind it — it can only ever return []',
    ).not.toContain('web_search')
    expect(
      Object.keys(agent.approvals),
      'an approval entry survived for a tool the agent was not given; the framework refuses that ' +
        'map at construction, so the agent would fail to start',
    ).not.toContain('web_search')
    // Anti-vacuity: an agent that lost its whole web section, or compiled to nothing at all, would
    // satisfy both assertions above for entirely the wrong reason.
    expect(names, 'the web section did not survive withholding one tool from it').toContain(
      'web_fetch',
    )
    expect(Object.keys(agent.approvals).length).toBeGreaterThan(3)
  })

  it('test_web_search_is_declared_and_gated_when_a_provider_is_configured', async () => {
    // The counter-proof. Without it, withholding the tool unconditionally would pass the test above
    // while silently deleting a capability — the worse outcome of the two.
    vi.stubEnv('THEOKIT_SEARCH_API_URL', 'https://search.example.invalid/q')
    const agent = await compile({ surface: 'headless', cwd: '/p' })

    expect(
      namesOf(agent),
      'a configured search provider did not get its tool declared — the capability was dropped, ' +
        'not scoped',
    ).toContain('web_search')
    expect(
      Object.keys(agent.approvals),
      'web_search reaches the network on the user behalf and lost its approval gate',
    ).toContain('web_search')
  })

  it('test_the_model_can_look_at_an_image_in_the_working_tree', async () => {
    // B-082 built `view_image` and registered it, and no agent ever held it: the registry resolved
    // it, so the test named "view_image is wired" passed, while the compiled agent declared 16
    // tools without it. The capability the item exists for — the model deciding to look at a
    // screenshot it just produced — did not exist. Asserting on the AGENT is what the registry
    // assertion could not do.
    const headless = await compile({ surface: 'headless', cwd: '/p' })
    const interactive = await compile({ surface: 'interactive', cwd: '/p' })

    expect(
      namesOf(headless),
      'view_image is built by the registry and handed to no one — dead weight in the registry and ' +
        'a capability the model does not have',
    ).toContain('view_image')
    expect(namesOf(interactive)).toContain('view_image')
  })

  it('test_reading_tools_including_view_image_are_not_approval_gated', async () => {
    // The decision recorded at the registration site: `view_image` reads a file under the SAME root
    // through the SAME containment rule as `read_file`, which is ungated. Gating it would gate the
    // rendering rather than the access, and a card that protects nothing is what teaches users to
    // click through the cards that do.
    const agent = await compile({ surface: 'headless', cwd: '/p' })
    const gated = new Set(Object.keys(agent.approvals))

    for (const reads of ['read_file', 'view_image', 'list_dir', 'grep']) {
      expect(
        gated.has(reads),
        `"${reads}" only reads inside the workspace and was given an approval card, which is ` +
          'friction that protects nothing and devalues the cards on run_shell and apply_patch',
      ).toBe(false)
    }
    // Anti-vacuity: an agent with an EMPTY approvals map passes the loop above trivially, and would
    // mean every gate in the product had been dropped.
    expect(
      gated.has('run_shell'),
      'the approvals map is empty or missing run_shell, so the loop above proved nothing',
    ).toBe(true)
  })
})

describe('path 1 — buildChatAgent gates what the directory is trusted with', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveTrustPosture.mockReturnValue(TRUSTED)
    resolveEffectiveConfig.mockReturnValue(config('workspace-write'))
  })

  it('test_an_untrusted_directory_loads_no_repository_controlled_entity', async () => {
    // Anti-prompt-injection. Each of these is a path by which a cloned repository steers the agent
    // or, for MCP, obtains local process execution at agent init BEFORE any per-tool approval
    // (`chat.ts:295-298`).
    resolveTrustPosture.mockReturnValue(UNTRUSTED)
    const agent = await compile({ surface: 'headless', cwd: '/p' })

    expect(
      Object.keys(agent.mcpServers),
      'an untrusted repo got its MCP servers spawned — the loader offered one and the gate let it ' +
        'through, which is arbitrary local process execution at agent init, before any per-tool ' +
        'approval exists to refuse it',
    ).toEqual([])
    expect(agent.skills, 'an untrusted repo got its SKILL.md into the persona').toEqual([])
    // M86 — `@theokit/agents@8.0.0` replaced the string list with a selection: `user` is a boolean,
    // and `project` is present only when a `TrustPosture` authorizes it. What this assertion proves
    // is unchanged, and it is now expressed as the ABSENCE of the key — an untrusted repo must not
    // even request the root, because a requested-but-ungranted `project` is a hard refusal, and a
    // present-but-denying grant would be a claim the gate is on when it is not.
    expect(
      agent.settingSources,
      'the `project` setting source stayed on for an untrusted repo, which re-enables repository ' +
        'subagents and repository hooks behind the per-hook fingerprint gate (B-008)',
    ).toEqual({ user: true })
    expect(agent.memory.enabled, 'memory writes into an untrusted working tree').toBe(false)
  })

  it('test_a_trusted_directory_does_load_them', async () => {
    // Anti-vacuity floor for the test above: without this, gating everything off unconditionally
    // would pass.
    const agent = await compile({ surface: 'headless', cwd: '/p' })

    expect(agent.skills).toEqual(['code-review'])
    // The counter-proof to the untrusted case, in the M86 shape: `project` is present, and the grant
    // carries the posture that authorized it — including `source`, so a refusal further down can say
    // where the decision came from rather than only that it was refused.
    const grant = {
      trustedBy: { level: 'trusted', source: 'store', allows: { projectSettings: true } },
    }
    // #65 — `claudeCode` carries the SAME evidence, deliberately. `.claude/` is repository-controlled
    // and holds a `hooks.json` that executes shell, so the second door takes the evidence the first
    // one takes; a weaker grant would be a gate with a bypass named after another product.
    //
    // #130 — and it carries one field the native root does not: which surfaces to import. Same
    // evidence, narrower import. Asserted whole rather than by field, because this is the drift
    // guard for what reaches the framework, and a per-field check would pass a build that lost the
    // list entirely.
    //
    // `'context'` joined the list for B-011: the SDK gained a grant for the foreign root's
    // INSTRUCTIONS (`.claude/rules/*.md`), which until then reached the system prompt through a door
    // the other four surfaces were correctly refused at. A narrowed `import` without that name loses
    // them once the grant is enforced — silently, which is the failure the grant exists to prevent,
    // arriving from this side. Not a widening: this product already received those rules on every
    // run, and the name is what keeps that true.
    expect(agent.settingSources).toEqual({
      user: true,
      project: grant,
      claudeCode: { ...grant, import: ['skills', 'subagents', 'plugins', 'commands', 'context'] },
    })
    // Trust is necessary and no longer sufficient: memory is off unless the config asks for it, so
    // a trusted directory alone leaves it off. The two halves are asserted apart, below, because
    // collapsing them would let either one carry the other.
    expect(agent.memory.enabled, 'a trusted directory turned memory on by itself').toBe(false)
    expect(
      Object.keys(agent.mcpServers),
      'the trusted build dropped the MCP server the loader offered — the gate is refusing what it ' +
        'should admit, and the untrusted assertion above would then pass for the wrong reason',
    ).toEqual(['some-server'])
  })

  it('test_memory_needs_BOTH_a_trusted_directory_and_a_config_that_asks_for_it', async () => {
    // Two gates, and the failure mode is that one silently carries the other. Codex ships the same
    // capability with `default_enabled: false`, and this product had it on for every trusted
    // directory with no config key at all — so the trust gate was doing work the config gate should
    // have been doing, and nobody could turn it off without editing files outside the product.
    //
    // Asserted as a truth table rather than one case, because three of the four combinations are
    // "off" and only their CONJUNCTION is "on". A test of the on-case alone passes against a build
    // that ignores trust; a test of one off-case alone passes against a build that ignores config.
    resolveEffectiveConfig.mockReturnValue({ ...config('workspace-write'), memory: true })
    const trustedAndAsked = await compile({ surface: 'headless', cwd: '/p' })

    resolveTrustPosture.mockReturnValue(UNTRUSTED)
    const untrustedButAsked = await compile({ surface: 'headless', cwd: '/p' })

    resolveTrustPosture.mockReturnValue(TRUSTED)
    resolveEffectiveConfig.mockReturnValue({ ...config('workspace-write'), memory: false })
    const trustedNotAsked = await compile({ surface: 'headless', cwd: '/p' })

    expect(trustedAndAsked.memory.enabled, 'both gates open and memory stayed off').toBe(true)
    expect(
      untrustedButAsked.memory.enabled,
      'config re-enabled memory in a directory whose posture forbids writing to it',
    ).toBe(false)
    expect(
      trustedNotAsked.memory.enabled,
      'trust alone turned memory on — the config gate is not being read',
    ).toBe(false)
  })

  it('test_an_absent_memory_key_is_off_rather_than_undefined', async () => {
    // `&&` yields the first falsy OPERAND, so a config without the key produced `undefined` — which
    // the SDK reads as off, and which no type check rejects because the field is optional upstream.
    // It looks identical to `false` in every behavioural assertion and is not the same value.
    const { memory: _dropped, ...withoutTheKey } = config('workspace-write')
    // `as never` matches every other mock in this file. The fixture is deliberately MISSING a field
    // the real config declares, which is the whole point of this case — so the cast is the subject,
    // not a convenience.
    resolveEffectiveConfig.mockReturnValue(withoutTheKey as never)

    const agent = await compile({ surface: 'headless', cwd: '/p' })

    expect(agent.memory.enabled, 'the gate leaked `undefined` instead of a boolean').toBe(false)
  })

  it('test_the_headless_profile_drops_the_tool_that_needs_a_terminal_to_answer', async () => {
    // B-001: `request_user_input` resolves through a bridge only the TUI subscribes to. Registered
    // headless, every call stalls until the built-in's five-minute timeout.
    const headless = await compile({ surface: 'headless', cwd: '/p' })
    const interactive = await compile({ surface: 'interactive', cwd: '/p' })

    expect(namesOf(headless)).not.toContain('request_user_input')
    expect(namesOf(interactive)).toContain('request_user_input')
  })

  it('test_extraTools_is_the_seam_and_it_reaches_the_compiled_agent', async () => {
    // The one documented way to extend the chain (`chat.ts:326-328`) — goal mode registers
    // `update_goal` through it instead of building a second agent.
    const agent = await compile({
      surface: 'headless',
      cwd: '/p',
      extraTools: [{ name: 'update_goal' }],
    })

    expect(namesOf(agent)).toContain('update_goal')
  })
})

describe('path 2 — createReviewAgent composes the reviewer', () => {
  it('test_the_reviewer_receives_exactly_its_declared_tool_set', async () => {
    // The reviewer reads a diff and reports. Any tool beyond its declared four is authority it was
    // never meant to hold — and the list is a hardcoded literal, so nothing but this test guards it.
    const { createReviewAgent } = await import('../src/review/create-agent.js')
    let captured: { tools: { name: string }[] } | undefined

    const createAgent = createReviewAgent({
      config: { model: 'gpt-5.4', sandbox_mode: 'read-only' },
      cwd: '/p',
      // #101 — the whole credential now; an API-key one, so the model is NOT routed here.
      credential: () => Promise.resolve({ apiKey: 'k', kind: 'apiKey', provider: 'openai' } as never),
      registerCleanup: () => undefined,
      createInstance: (opts) => {
        captured = opts as unknown as { tools: { name: string }[] }
        return Promise.resolve({
          send: () => Promise.resolve({ wait: () => Promise.resolve({}) }),
          [Symbol.asyncDispose]: () => Promise.resolve(),
        } as never)
      },
      deleteAgent: () => Promise.resolve(),
    })

    await createAgent({ agentId: 'r1', systemPrompt: 'review it' })
    const names = captured?.tools.map((t) => t.name).sort() ?? []

    // The expected set is written OUT here rather than compared against `REVIEWER_TOOLS`.
    // Measured: comparing to the constant made this test tautological — a mutation adding
    // `apply_patch` to the constant changed both sides at once and survived. A characterization
    // test has to state the expectation independently of the thing it characterises.
    expect(names).toEqual(['git_diff', 'grep', 'read_file', 'run_shell'])

    // And the property behind the list, so a future addition is judged rather than merely noticed:
    // the reviewer reads a diff and reports on it. Anything that mutates the tree or delegates
    // authority onward is not part of that job.
    for (const forbidden of ['apply_patch', 'edit_file', 'delegate_to_team', 'interactive_shell']) {
      expect(
        names,
        `the reviewer was handed "${forbidden}" — it reads a diff and reports; a tool that mutates ` +
          'the tree or delegates authority onward is not part of that job, and the user approved ' +
          'a review rather than an edit',
      ).not.toContain(forbidden)
    }
  })

  it('test_the_reviewer_tool_set_is_a_subset_of_the_registry', async () => {
    // `ToolRegistry.resolve` fails loud on an unknown name, so a typo in the literal is a runtime
    // throw at review time — the moment the user is already waiting.
    // From `registry.js`, not the `tools/index.js` barrel: the barrel re-exports `ToolRegistry`
    // and `resolveToolScope` but not the name list, so the registry's own vocabulary is not part
    // of the module's public face.
    const { REGISTRY_TOOL_NAMES } = await import('../src/tools/registry.js')
    // From `composition/agent-spec.js`, where the list is declared and where `reviewerShape` reads
    // it. This used to import from `review/create-agent.js`, which re-exported the name for this
    // test alone — surface kept alive by its only consumer being the test that consumed it.
    const { REVIEWER_TOOLS } = await import('../src/composition/agent-spec.js')
    for (const name of REVIEWER_TOOLS) {
      expect(
        (REGISTRY_TOOL_NAMES as readonly string[]).includes(name),
        `the reviewer declares "${name}", which the registry does not build`,
      ).toBe(true)
    }
  })

  it('test_the_reviewer_shell_is_capped_below_the_default', async () => {
    // A reviewer that can run a 5-minute command is a reviewer that can hang the release.
    const { REVIEWER_SHELL_CAP } = await import('../src/review/create-agent.js')
    expect(REVIEWER_SHELL_CAP).toBeLessThan(300_000)
  })
})

describe('path 3 — buildRoleAgent composes a delegated team member', () => {
  /** A sandbox backend double: the seam exists so a member is never handed an unconfined shell. */
  const sandbox = { enabled: true, workDir: '/p' } as never

  async function buildRole(role: string, allows: { subagents: boolean }) {
    const { buildRoleAgent } = await import('../src/delegation/roles.js')
    let captured: { tools: { name: string }[]; local: { cwd: string } } | undefined
    await buildRoleAgent(role, {
      apiKey: 'test-key-not-a-real-credential',
      parent: { model: 'gpt-5.4', reasoning_effort: 'medium' },
      cwd: '/p',
      writeRoot: '/p',
      sandbox,
      posture: { level: 'trusted', source: 'store', allows } as never,
      createAgent: (opts: unknown) => {
        captured = opts as unknown as { tools: { name: string }[]; local: { cwd: string } }
        return Promise.resolve({} as never)
      },
    } as never)
    return captured
  }

  it('test_a_role_receives_only_the_tools_its_definition_declares', async () => {
    // A role's tool list is its authority. `explorer` reads; if it silently gained `run_shell` or
    // `apply_patch`, the read-only half of the sequential team would stop being read-only and the
    // approval the parent showed for `delegate_to_team` would have covered more than it said.
    const explorer = await buildRole('explorer', { subagents: true })

    expect(explorer?.tools.map((t) => t.name).sort()).toEqual(['grep', 'list_dir', 'read_file'])
  })

  it('test_a_role_is_confined_to_the_directory_the_parent_resolved', async () => {
    // B-032: `resolveToolScope` derives the writeRoot AND the sandbox workDir from this value, so a
    // member built against the process directory writes into a tree the caller did not choose.
    const worker = await buildRole('worker', { subagents: true })

    expect(worker?.local.cwd).toBe('/p')
  })

  it('test_an_untrusted_directory_still_materialises_the_operator_own_role', async () => {
    // #65 — the counterpart of the refusal below, and the reason it must be stated: the gate asks
    // whether the code in THIS directory is trusted, and nobody's home is the repository. A role the
    // operator wrote for themselves is theirs in every directory they visit; refusing it because a
    // stranger's repository is untrusted would withhold someone's own configuration from them.
    //
    // What is NOT relaxed is the line above it: the definition here comes from the home, never from
    // the untrusted repository, so nothing in that repository chooses the member's model, effort or
    // sandbox flag.
    const { buildRoleAgent } = await import('../src/delegation/roles.js')
    operatorRoles = { explorer: { tools: ['read_file'] } }

    try {
      await expect(
        buildRoleAgent('explorer', {
          apiKey: 'test-key-not-a-real-credential',
          parent: { model: 'gpt-5.4', reasoning_effort: 'medium' },
          cwd: '/p',
          sandbox,
          posture: { level: 'untrusted', source: 'store', allows: { subagents: false } } as never,
          createAgent: () => Promise.resolve({} as never),
        } as never),
      ).resolves.toBeDefined()
    } finally {
      operatorRoles = {}
    }
  })

  it('test_an_untrusted_directory_refuses_to_materialise_a_repository_role', async () => {
    // The refusal is the feature: `.theokit/agents/<name>.md` is repository-controlled, so an
    // untrusted repo could otherwise choose a member's model, effort and sandbox flag.
    const { buildRoleAgent } = await import('../src/delegation/roles.js')

    await expect(
      buildRoleAgent('explorer', {
        apiKey: 'test-key-not-a-real-credential',
        parent: { model: 'gpt-5.4', reasoning_effort: 'medium' },
        cwd: '/p',
        sandbox,
        posture: { level: 'untrusted', source: 'store', allows: { subagents: false } } as never,
        createAgent: () => Promise.resolve({} as never),
      } as never),
    ).rejects.toThrow(/not trusted/i)
  })
})
