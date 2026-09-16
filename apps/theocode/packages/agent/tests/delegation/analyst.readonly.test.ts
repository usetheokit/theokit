/**
 * #80 — the analyst's declared boundary and its effective one are the same boundary.
 *
 * The defect: the analyst is declared read-only in TWO places — a three-tool list and instructions
 * that say in words *"You cannot edit files or run commands"* — and it advertised `shell`. Measured
 * on the built binary, asked to enumerate its own catalog, `shell` came FIRST. The unit test
 * asserting its declared list passed throughout: the list was right, the catalog was not.
 *
 * That is why this file asserts the WITHHOLDING and not the tool list. A test over
 * `ANALYST_TOOLS` is the test that already existed and already passed while the bug was live —
 * re-asserting it here would reproduce the blind spot rather than close it.
 */
import { effectiveToolNames } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { ToolRegistry, resolveToolScope } from '../../src/tools/index.js'
import { analystSpec, createAnalystSubagent } from '../../src/delegation/analyst.js'

const registry = (): ToolRegistry =>
  new ToolRegistry(resolveToolScope({ sandbox_mode: 'read-only' }, '/p'))

describe('#80 — the analyst does not carry a builtin it was never granted', () => {
  it('test_the_effective_catalog_holds_no_shell', () => {
    // #583 — the assertion this file wanted from the start, and could not make until
    // `@theokit/sdk@5.2.0` published `effectiveToolNames`. The two arms below assert the INPUTS
    // (the declared list, the withholding field); this one asserts the OUTPUT — what the runtime
    // will actually put in front of the model.
    //
    // That distinction is the whole defect. The declared list was right the entire time the bug was
    // live; the catalog was not, and nothing in CI could see the catalog. The only instrument was
    // the built binary with a credential, asking the agent to enumerate its own tools in prose.
    //
    // `unresolved` is asserted empty, not ignored. It names the configured sources that could not be
    // enumerated — MCP needs a live connection, plugins and reasoning are assembled per run — and
    // `names` may only be read as the COMPLETE catalog when it is empty. Dropping this assertion
    // would turn a partial answer into a confident one, which is the failure the return shape was
    // designed to prevent.
    const catalog = effectiveToolNames(analystSpec('gpt-5.4', registry()))

    expect(catalog.unresolved, 'names is only the whole catalog when nothing is unresolved').toEqual([])
    expect(catalog.names, 'the analyst says it cannot run commands; the runtime disagreed').not.toContain('shell')
    expect([...catalog.names].sort()).toEqual(['grep', 'list_dir', 'read_file'])
  })

  it('test_the_spec_withholds_the_builtin_shell', () => {
    const spec = analystSpec('gpt-5.4', registry())
    expect(
      spec.withheldBuiltinTools,
      'the analyst says it cannot run commands; without this it can',
    ).toContain('shell')
  })

  it('test_no_shell_of_any_kind_is_in_its_declared_list', () => {
    // The other half of the claim, and the reason withholding is SAFE here rather than merely
    // desirable: nothing this agent was granted travels under the withheld name. The sibling
    // `roles.ts` withholds the same builtin and keeps `run_shell`, which is this product's own tool.
    // If someone ever adds an execution tool to `ANALYST_TOOLS`, this arm is what says so.
    const names = (analystSpec('gpt-5.4', registry()).tools ?? []).map((t) => t.name)
    expect(names.sort()).toEqual(['grep', 'list_dir', 'read_file'])
  })

  it('test_the_seam_is_required_because_a_created_subagent_is_refused', () => {
    // Upstream #583, and the reason `analystSpec` exists as a separate function.
    //
    // `SubAgent.create` returns `{ name, description, inputSchema, handler }` and closes the spec
    // inside the handler. In `@theokit/sdk@5.2.0` that object satisfied `AgentOptions` BY VACUITY —
    // every field optional — so `effectiveToolNames` answered `{ names: ["shell"], unresolved: [] }`
    // for it: a plausible wrong answer asserting completeness, about an object it never described.
    // Reported from here and fixed in `5.2.1`, which now refuses it.
    //
    // Pinned as an arm rather than trusted, because this repository's read-only claim depends on
    // measuring the SPEC, and a silent return to the old behaviour would make the arm above answer
    // about the wrong thing while still passing.
    let thrown: unknown
    try {
      effectiveToolNames(createAnalystSubagent('gpt-5.4', registry()) as never)
    } catch (e) {
      thrown = e
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('effective_tools_expected_options')
  })
})
