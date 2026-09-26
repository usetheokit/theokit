/**
 * The agents scan is rooted at the PROJECT ROOT, not at the parent of `serverDir`.
 *
 * Found in the build output of a live Cloudflare deploy, 2026-09-26 (B-312):
 *
 *     [theokit] agentsDir "src/server/agents" resolves to "…/my-test/src/src/server/agents",
 *     which is not a directory, so NO agents were found and every /api/agents/* route will 404.
 *     The value is a path relative to the project root "…/my-test/src"
 *
 * `src/src/` is the whole defect. The provider passed `dirname(resolve(cwd, serverDir))` as the
 * root, which equals the project root ONLY when `serverDir` is a direct child of it. With
 * `serverDir: 'src/server'` that expression is `<root>/src`, and `config.agentsDir` is documented
 * and declared relative to `<root>` — so `join()` produced `<root>/src/src/server/agents`,
 * `scanAgents` returned `[]`, and the built worker carried zero agents.
 *
 * ## Why this reached a deploy
 *
 * `scanAgents([]) ` is byte-identical to "this app declares no agents", which is the ordinary case.
 * The only signal was the warning above, and it is printed by `agent-scan.ts` rather than by the
 * caller that got the argument wrong. It fires on every scanned target — Cloudflare, Vercel — and
 * `manifest-loader.ts` and `agent-middleware.ts` both already pass the project root, so this one
 * caller was the outlier.
 *
 * ## Why the test needed an extraction
 *
 * The provider was a closure inside `buildCommand`, which loads a config, runs vite twice and
 * writes a tree. Nothing could ask it one question about one call, which is why a wrong argument
 * survived. It is `createBuildScanRoutes` now, and this file is the one question.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { _resetAgentPolicyCacheForTests } from '../../packages/theo/src/server/scan/agent-scan.js'
import { createBuildScanRoutes } from '../../packages/theo/src/cli/commands/build-scan-routes.js'

/**
 * `agents` is OPTIONAL on the `AdapterBuildContext` contract, so it is narrowed rather than asserted
 * with `!`. That matters here beyond lint: an absent field and an empty list are different facts, and
 * this file's whole subject is a scan that returned the second when it should have returned entries.
 * Failing on `undefined` with its own message keeps the two apart in the output.
 */
function agentNames(result: { agents?: readonly { name: string }[] }): readonly string[] {
  const { agents } = result
  if (agents === undefined) throw new Error('the scan returned no `agents` field at all')
  return agents.map((agent) => agent.name)
}

/**
 * A real agent file. `policy` is not decoration here: `scanAgents` calls
 * `assertAgentDeclaresPolicy` and THROWS `MissingAgentPolicyError` without it (ADR 0001), so an
 * agent fixture missing it fails every case in this file for a reason that has nothing to do with
 * the root being scanned. Measured while writing it — the flat-layout counterproof, which must pass
 * on the fixed module, failed on exactly that.
 */
const AGENT = `export const policy = 'public'\nexport default { name: 'chat' }\n`

describe('the build scans agents from the project root', () => {
  const root = mkdtempSync(join(tmpdir(), 'theokit-scan-root-'))

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  // The policy-declaration cache is module-level and keyed on path + mtime + size, so it outlives a
  // fixture directory. The scanner ships the seam for precisely this.
  beforeEach(() => {
    _resetAgentPolicyCacheForTests()
  })

  /** A project whose `serverDir` is nested, which is what the scaffold's own config declares. */
  function nestedProject(name: string): string {
    const dir = join(root, name)
    mkdirSync(join(dir, 'src', 'server', 'agents'), { recursive: true })
    mkdirSync(join(dir, 'src', 'server', 'routes'), { recursive: true })
    writeFileSync(join(dir, 'src', 'server', 'agents', 'chat.ts'), AGENT, 'utf8')
    return dir
  }

  it('test_a_nested_server_dir_still_finds_its_agents', () => {
    const project = nestedProject('nested')
    const scan = createBuildScanRoutes(project, { agentsDir: 'src/server/agents' })

    const result = scan('src/server')

    expect(
      agentNames(result),
      'the agents scan was rooted at the parent of serverDir, so a root-relative agentsDir was ' +
        'joined onto <root>/src and resolved to <root>/src/src/server/agents — every ' +
        '/api/agents/* route 404s on every scanned deploy target',
    ).toEqual(['chat'])
  })

  it('test_the_agent_path_is_relative_to_the_project_root', () => {
    // The string is both the emitted import specifier and the key the executor looks the module up
    // by. A path relative to the wrong root resolves to nothing at request time, which is the same
    // 404 arriving one layer later.
    const project = nestedProject('relative')
    const scan = createBuildScanRoutes(project, { agentsDir: 'src/server/agents' })

    expect(scan('src/server').agents?.[0]?.filePath).toBe('src/server/agents/chat.ts')
  })

  it('test_the_flat_default_layout_still_works', () => {
    // COUNTERPROOF, and the reason the defect survived: with `serverDir: 'server'` the old
    // expression `dirname(<root>/server)` IS the project root, so the flat layout — the schema
    // default — was always correct. A fix measured only against it would look like a no-op.
    const project = join(root, 'flat')
    mkdirSync(join(project, 'server', 'routes'), { recursive: true })
    mkdirSync(join(project, 'agents'), { recursive: true })
    writeFileSync(join(project, 'agents', 'chat.ts'), AGENT, 'utf8')

    const scan = createBuildScanRoutes(project, { agentsDir: 'agents' })

    expect(agentNames(scan('server'))).toEqual(['chat'])
  })

  it('test_no_configured_agents_dir_is_not_an_error', () => {
    // `agentsDir` is optional and `scanAgents` defaults it to 'agents'. A project with none must
    // yield an empty list rather than throwing — this is the ordinary case for most apps.
    const project = join(root, 'none')
    mkdirSync(join(project, 'src', 'server', 'routes'), { recursive: true })

    expect(agentNames(createBuildScanRoutes(project, {})('src/server'))).toEqual([])
  })

  it('test_the_context_module_is_still_resolved_against_server_dir', () => {
    // COUNTERPROOF for the fix's blast radius: `contextModule` and the route scans are rooted at
    // `serverDir`, NOT at the project root, and changing the agents root must not move them. A fix
    // that replaced `abs` throughout would pass every case above and lose the identity module.
    const project = join(root, 'context')
    mkdirSync(join(project, 'src', 'server', 'routes'), { recursive: true })
    writeFileSync(join(project, 'src', 'server', 'context.ts'), 'export default {}\n', 'utf8')

    expect(createBuildScanRoutes(project, {})('src/server').contextModule).toBe(
      'src/server/context.ts',
    )
  })
})
