import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'
import {
  scanAgents,
  _resetAgentPolicyCacheForTests,
} from '../../packages/theo/src/server/scan/agent-scan.js'
import { MissingAgentPolicyError } from '../../packages/theo/src/server/scan/errors.js'

/**
 * ADR 0001, Decision point 5 — "absence stops meaning open" — extended from routes to the agent
 * surface (usetheokit/theokit#365).
 *
 * ## Why absence had to be refused at the SCANNER and not at the endpoint
 *
 * The agent endpoints resume a conversation the caller names. There is no runtime default that is
 * both safe and non-breaking: refusing every caller-supplied session id would break multi-turn
 * chat, which is the base case, and admitting them is the defect. So the question moves to where a
 * person answers it once, in the file that owns the agent.
 *
 * ## Where the gate deliberately stops
 *
 * On agents read from the file system, which is what an application declares and what `theokit
 * build` / `theokit start` / `theokit dev` load. A module handed to `mountAgent` in memory — a
 * test, an embedder, an `@Expose`d controller method — never passed a scanner, and the runtime
 * still treats an undeclared policy as "not declared" rather than as denial. The last test in this
 * file is what holds that line.
 */

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'theo-agent-policy-gate-'))
  mkdirSync(join(projectRoot, 'agents'), { recursive: true })
  // The declaration answer is cached by path + mtime + size so `theokit dev` does not re-parse on
  // every request. A fresh tmpdir per test makes the key unique, but clearing keeps the tests
  // independent of that accident.
  _resetAgentPolicyCacheForTests()
})

function writeAgent(relativePath: string, content: string): string {
  const full = join(projectRoot, 'agents', relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return full
}

describe('the scanner refuses an agent that declares no access policy (#365)', () => {
  it('test_an_agent_file_with_no_policy_export_fails_the_scan_naming_the_file_and_the_url', () => {
    const file = writeAgent('support.ts', `export default { model: 'm' }\n`)

    let thrown: unknown
    try {
      scanAgents(projectRoot)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(MissingAgentPolicyError)
    const error = thrown as MissingAgentPolicyError
    expect(error.file).toBe(file)
    // The URL, not just the path on disk: the message has to read like the app somebody deployed.
    expect(error.agentPath).toBe('/api/agents/support')
    // Naming the remedy is the point of failing here rather than at request time.
    expect(error.message).toContain(`export const policy = 'public'`)
    expect(error.message).toContain('requireOwner')
  })

  it('test_a_public_declaration_passes_the_scan', () => {
    writeAgent('support.ts', `export const policy = 'public'\nexport default { model: 'm' }\n`)

    expect(scanAgents(projectRoot).map((a) => a.name)).toEqual(['support'])
  })

  it('test_a_function_policy_passes_the_scan', () => {
    writeAgent(
      'support.ts',
      `export const policy = ({ subject }) => subject !== null\nexport default { model: 'm' }\n`,
    )

    expect(scanAgents(projectRoot).map((a) => a.name)).toEqual(['support'])
  })

  it('test_a_re_exported_policy_passes_the_scan', () => {
    // Unlike a route's HTTP method, the export IS the policy — there is nothing to look inside, so
    // a re-export names one as surely as a local const does. The VALUE's shape is checked at
    // runtime by `readAgentPolicy`, which throws on anything that is neither 'public' nor a
    // function, so a wrong type fails loudly instead of being served open.
    // Under `lib/`, which the scanner treats as composition rather than as a second agent.
    writeAgent('lib/shared.ts', `export const agentPolicy = 'public'\n`)
    writeAgent(
      'support.ts',
      `export { agentPolicy as policy } from './lib/shared.js'\nexport default { model: 'm' }\n`,
    )

    expect(scanAgents(projectRoot).map((a) => a.name)).toEqual(['support'])
  })

  it('test_the_word_policy_in_a_comment_declares_nothing', () => {
    // The reason this uses the TypeScript AST and not a regex: the comment below is the most
    // likely thing to appear in a file whose author decided NOT to declare a policy.
    //
    // The marker is assembled rather than written out, and that is not squeamishness:
    // `tests/lint/task-marker.test.ts` scans this repository for forgotten task markers with a
    // line-based regex, and its own contract says a marker inside a string is NOT debt — row three
    // of its table, about `theo generate`'s scaffold output. It cannot actually tell, because a
    // regex sees a line and not a syntax tree, so a literal here reads as debt of ours. The fixture
    // that reaches the scanner is byte-identical either way.
    const markerWord = ['TO', 'DO'].join('')
    const forgottenMarker = `// ${markerWord}: add a policy here — export const policy = 'public'`

    writeAgent(
      'support.ts',
      [
        forgottenMarker,
        `/** The policy for this agent is still undecided. */`,
        `export default { model: 'm' }`,
        ``,
      ].join('\n'),
    )

    expect(() => scanAgents(projectRoot)).toThrow(MissingAgentPolicyError)
  })

  it('test_a_composition_subfolder_file_needs_no_policy', () => {
    // `agents/tools/weather.ts` is a tool, not a routed agent. Demanding a policy of it would be
    // demanding one of a file that serves no URL.
    writeAgent('chat.ts', `export const policy = 'public'\nexport default { model: 'm' }\n`)
    writeAgent('tools/weather.ts', `export const weatherTool = {}\n`)

    expect(scanAgents(projectRoot).map((a) => a.name)).toEqual(['chat'])
  })

  it('test_an_in_memory_module_still_reaches_mountAgent_without_a_policy', async () => {
    // The line the gate stops at. Converting this into a runtime denial would break every direct
    // caller at once, which is the all-at-once break the migration exists to avoid — the same
    // boundary `evaluateRoutePolicy` documents for a `RouteConfig` built in memory.
    const request = new Request('http://localhost/api/agents/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
      body: JSON.stringify({ message: 'hi' }),
    })

    // Reaching the compiler is the oracle: it means nothing refused before it.
    await expect(mountAgent({ default: { __theoAgent: true } }, request, 'k', {})).rejects.toThrow(
      /must default-export/,
    )
  })
})
