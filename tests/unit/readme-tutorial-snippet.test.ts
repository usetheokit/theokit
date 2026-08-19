import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The README's "Your first agent in 5 minutes" teaches the framework's own authoring surface.
 *
 * It used to teach `@theokit/sdk` directly — `Agent.create()`, then
 * `const result = await agent.send(msg, { throwOnError: true }); console.log(result.text)`. That
 * snippet did not work: `send()` resolves to a `Run`, which has no `text`; the terminal value comes
 * from `await run.wait()` as `RunResult.result`. The assertions here pinned that snippet in place,
 * so the first thing a reader copied was broken and the suite defended it.
 *
 * What the tutorial must show instead is the framework: an agent is a file under `agents/`, authored
 * with the `AgentBuilder.create()` chain (M31 builder-only — the `@Agent` / `defineAgent` surfaces
 * are internal), and reached from the client with `useAgent`.
 *
 * Greps are scoped to the tutorial section (from `## Your first agent` to the next `## ` heading) so
 * an unrelated snippet further down the README cannot satisfy or break them.
 */

const README = readFileSync(resolve(__dirname, '../../README.md'), 'utf-8')

function tutorialSection(readme: string): string {
  const start = readme.indexOf('## Your first agent')
  if (start === -1) throw new Error('Tutorial section not found in README.md')
  const rest = readme.slice(start)
  const nextHeading = rest.slice(2).search(/^## /m)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading + 2)
}

const TUTORIAL = tutorialSection(README)

describe('README "Your first agent in 5 minutes"', () => {
  it('tutorial section exists', () => {
    expect(TUTORIAL.length).toBeGreaterThan(100)
    expect(TUTORIAL).toMatch(/Your first agent in 5 minutes/)
  })

  it('teaches the file-based agent', () => {
    expect(TUTORIAL).toMatch(/agents\/\w[\w-]*\.ts/)
    expect(TUTORIAL).toContain('/api/agents/')
  })

  it('authors it with the AgentBuilder chain, including the required .model()', () => {
    expect(TUTORIAL).toMatch(/AgentBuilder\.create\(\)/)
    expect(TUTORIAL).toMatch(/\.model\(/)
    expect(TUTORIAL).toMatch(/\.build\(\)/)
  })

  it('names a provider key so the reader can actually run it', () => {
    expect(TUTORIAL).toMatch(/OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY/)
  })

  it('reaches the agent from the client with useAgent', () => {
    expect(TUTORIAL).toMatch(/useAgent/)
  })

  it('does NOT teach an authoring surface that was removed from the public API', () => {
    expect(TUTORIAL).not.toMatch(/@Agent\b|@Toolbox\b|@MainLoop\b/)
    expect(TUTORIAL).not.toMatch(/defineAgentTool|defineAgent\b/)
  })

  it('does NOT reintroduce the broken SDK snippet (`send()` read as if it were the result)', () => {
    expect(TUTORIAL).not.toContain('result.text')
    // `agent.send(...)` is only correct in the tutorial when its terminal value is awaited.
    if (TUTORIAL.includes('.send(')) {
      expect(TUTORIAL).toMatch(/\.wait\(\)/)
    }
  })
})
