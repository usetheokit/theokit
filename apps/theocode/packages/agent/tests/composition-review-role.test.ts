/**
 * B-061 — composition of the reviewer (path 2, `createReviewAgent`) and of a delegated team member
 * (path 3, `buildRoleAgent`). Split from `composition.test.ts` (the chat agent, path 1) to keep both
 * files under the `max-lines` limit; the assertions are on the compiled definition, as there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tempRoot } from './helpers/temp-root.js'

// HOME is isolated as in `composition.test.ts`: the operator's own roots must not leak in.
beforeEach(() => {
  vi.stubEnv('HOME', tempRoot('composition-home-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** What the project's `.theokit/agents/` declares in these tests. */
const PROJECT_ROLES = {
  explorer: { tools: ['Read', 'Grep', 'Glob'] },
  worker: { tools: ['Read', 'ApplyPatch', 'Bash'] },
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
 * It returns the operator's roles always and the project's only under a grant, as the real
 * `discoverSubagentsAcrossRoots` does (#2925).
 */
const discoverSubagentsAcrossRoots = vi.fn((o: { project: unknown }) => {
  // Same honesty as before: the project half is returned only when the caller passed a grant.
  const definitions: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(operatorRoles)) {
    definitions[name] = { ...(def as object), origin: 'operator' }
  }
  if (o.project !== false) {
    for (const [name, def] of Object.entries(PROJECT_ROLES)) {
      definitions[name] = { ...(def as object), origin: 'project' }
    }
  }
  return Promise.resolve({ definitions, shadowed: {}, withheld: [] })
})

vi.mock('@theokit/agents/config', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  discoverSubagentsAcrossRoots,
}))

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
      credential: () =>
        Promise.resolve({ apiKey: 'k', kind: 'apiKey', provider: 'openai' } as never),
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
    // `ApplyPatch` to the constant changed both sides at once and survived. A characterization
    // test has to state the expectation independently of the thing it characterises.
    expect(names).toEqual(['Bash', 'GitDiff', 'Grep', 'Read'])

    // And the property behind the list, so a future addition is judged rather than merely noticed:
    // the reviewer reads a diff and reports on it. Anything that mutates the tree or delegates
    // authority onward is not part of that job.
    for (const forbidden of ['ApplyPatch', 'Edit', 'delegate_to_team', 'interactive_shell']) {
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
    // A role's tool list is its authority. `explorer` reads; if it silently gained `Bash` or
    // `ApplyPatch`, the read-only half of the sequential team would stop being read-only and the
    // approval the parent showed for `delegate_to_team` would have covered more than it said.
    const explorer = await buildRole('explorer', { subagents: true })

    expect(explorer?.tools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read'])
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
    operatorRoles = { explorer: { tools: ['Read'] } }

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
      // The gate closed at the framework call, not by a later check.
      expect(discoverSubagentsAcrossRoots).toHaveBeenLastCalledWith(
        expect.objectContaining({ project: false }),
      )
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
