/**
 * A deploy target resolves the caller's identity (T1.3 of B-185, ADR 0014).
 *
 * The item's second DoD asks for "an unauthenticated caller refused, an authenticated non-owner
 * refused, an owner SERVED" on a deployed target. Only the first works today: 0 of 23 adapter files
 * pass `resolveSubject`, so `agent-access.ts:146` judges every policy against `subject: null` and an
 * owner is refused exactly like a stranger.
 *
 * TWO MECHANISMS, and the split is the decision ADR 0014 records. `deployed-agents.ts:74-79` argues
 * it for routes already: Bun and Deno have a filesystem and scan at request time, so they pass the
 * `serverDir` they already emit and use the existing resolver unchanged. A Worker has no filesystem
 * on which to find `context.ts`, so the generator bakes it — measured, with `serverDir: undefined`
 * the existing resolver returns `subjectFromContext({})`, which is null for every caller.
 */
import { describe, expect, it } from 'vitest'

import { deployedAgentsFragment } from '../../packages/theo/src/adapters/deployed-agents.js'

const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

describe('a deploy target resolves a subject (B-185 T1.3)', () => {
  it('test_a_filesystem_target_resolves_a_subject_without_baking', () => {
    const fragment = deployedAgentsFragment(
      { kind: 'scan', projectRoot: 'cwd', loadModule: 'loadModule', serverDir: 'serverDir' },
      {},
    )
    const source = [...fragment.declarations, ...fragment.branch].join('\n')

    // The `serverDir` the entry already declares — `bun.ts:95`, `deno-deploy.ts:69` — threaded into
    // the deps, so the EXISTING resolver works unchanged on a host that has a filesystem.
    expect(source).toContain('createAgentSubjectResolver')
    expect(source).toMatch(/serverDir:\s*serverDir/)

    // And no baked context import: baking would tie an agent's identity to a rebuild on a target
    // that can read `context.ts` at request time, which is what ADR 0014 refuses for these two.
    expect(fragment.imports.join('\n')).not.toMatch(/context/i)
  })

  it('test_a_worker_bakes_the_context_module_when_the_app_has_one', () => {
    const fragment = deployedAgentsFragment(
      // Project-relative, exactly like `agent.filePath` beside it — the generator adds the `../../`
      // because it knows where the entry is written, and the caller does not.
      { kind: 'baked', agents: AGENTS, contextModule: 'server/context.js' },
      {},
    )

    // No filesystem: the module is a static import decided on the build machine, the same way
    // routes (#369), agent modules and plugins already are.
    expect(fragment.imports.join('\n')).toMatch(
      /import \* as __theoContext from '\.\.\/\.\.\/server\/context\.js'/,
    )
    expect([...fragment.declarations, ...fragment.branch].join('\n')).toContain(
      'createSubjectResolverFromFactory',
    )
  })

  it('test_an_app_with_no_context_module_still_builds', () => {
    const fragment = deployedAgentsFragment({ kind: 'baked', agents: AGENTS }, {})
    const source = [...fragment.imports, ...fragment.declarations, ...fragment.branch].join('\n')

    // `planDeployedPlugins` returns `undefined` when there is nothing to bake and the adapter passes
    // it straight through; the context module takes the same road. Emitting an import of a file the
    // app does not have would fail the BUILD, not the request.
    expect(source).not.toMatch(/__theoContext/)
    // That what it emits PARSES is `adapter-entry-parses.test.ts`'s property, asserted there with
    // `node --check` — the parser the runtime actually uses, rather than a `new Function` here that
    // would be a second, weaker answer to a question already owned.
  })
})
