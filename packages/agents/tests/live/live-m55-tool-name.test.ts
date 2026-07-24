/**
 * M55 LIVE proof — a NAMESPACED toolbox reaches a real provider and the model actually CALLS the
 * tool by its `namespace_tool` name. Run inside tmux `agentbuilder`:
 *
 *   node --env-file=<agent-builder>/.env node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *
 * Why live and not a unit test: theokit#145 was a documented path that never once worked against a
 * real provider, and every other suite in this package mocks `@theokit/sdk` — which is exactly why
 * nothing caught it. Only a real round-trip proves the name survives all the way to the model and
 * back through `pre_tool_call`.
 *
 * Prints (a) which env key is present — never its value, (b) the minted tool name, (c) the real
 * tool-call event observed in the stream.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { Agent } from '@theokit/sdk'

import { applyCapabilities } from '../../src/capability/capability.js'
import { ConfigurationError } from '../../src/capability/capabilities.js'
import { ToolboxCapability, type ToolDeclaration } from '../../src/capability/toolbox.js'

const MODEL = process.env.LIVE_MODEL ?? 'google/gemini-2.5-flash-lite'
const KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY']

function keyPresence(): string {
  const present = KEYS.filter((n) => (process.env[n] ?? '').length > 0)
  return present.length > 0 ? present.join(', ') : '(none)'
}

function apiKey(): string {
  for (const n of KEYS) {
    const v = process.env[n]
    if (v !== undefined && v.length > 0) return v
  }
  throw new Error('no provider key present in the environment')
}

const HAS_KEY = KEYS.some((n) => (process.env[n] ?? '').length > 0)

/** A toolbox whose answer the model cannot guess — so a correct answer PROVES the tool ran. */
class VaultTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'read_secret_number',
      description:
        'Returns the vault secret number. The ONLY way to know it — never guess or invent it.',
      input: z.object({}),
      method: 'readSecretNumber',
    },
  ]
  calls = 0
  readSecretNumber(): string {
    this.calls += 1
    return '751293'
  }
}

describe.skipIf(!HAS_KEY)('M55 LIVE — namespaced tool name against a real provider', () => {
  it('the model calls the tool by its `namespace_tool` name and uses the result', async () => {
    console.log(`[live] provider key present: ${keyPresence()}`)
    console.log(`[live] model: ${MODEL}`)

    const vault = new VaultTools()
    const compiled = applyCapabilities([new ToolboxCapability(vault, { namespace: 'vault' })])

    const mintedName = compiled.tools[0]?.name
    console.log(`[live] minted tool name: ${mintedName}`)
    expect(mintedName).toBe('vault_read_secret_number')

    const agent = await Agent.create({
      apiKey: apiKey(),
      model: { id: MODEL },
      systemPrompt:
        'You are a vault assistant. To answer any question about the secret number you MUST call ' +
        'the available tool. Never invent a number.',
      tools: compiled.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        handler: t.handler,
      })),
      local: { cwd: process.cwd() },
    } as never)

    const run = await agent.send('What is the vault secret number? Use your tool, then state it.')

    const toolCallNames: string[] = []
    for await (const event of run.stream()) {
      if (event.type === 'tool_call') {
        toolCallNames.push(event.name)
        console.log(`[live] tool_call event: name=${event.name} status=${event.status}`)
      }
    }

    const result = await run.wait()
    console.log(`[live] run status: ${result.status}`)
    const answer = result.result ?? ''
    console.log(`[live] answer: ${answer.slice(0, 300)}`)
    console.log(`[live] handler invocations: ${vault.calls}`)

    // The name survived the whole round-trip: authoring → Agent.create → provider → pre_tool_call.
    expect(toolCallNames).toContain('vault_read_secret_number')
    // The handler really ran (the name was not just accepted, it was DISPATCHED).
    expect(vault.calls).toBeGreaterThan(0)
    // The answer carries the value only the tool could supply.
    expect(answer).toContain('751293')
    expect(result.status).toBe('finished')

    await agent[Symbol.asyncDispose]()
  }, 120_000)

  it('the reserved-name rule is real: our authoring rejects what the live SDK rejects', async () => {
    // The defect M55 fixes: `namespace: 'mcp'` mints `mcp_*`, which passed our old authoring check
    // and was rejected by `Agent.create`. Now it fails at authoring — before any provider call.
    expect(() => new ToolboxCapability(new VaultTools(), { namespace: 'mcp' })).toThrow(
      ConfigurationError,
    )

    // And the SDK it mirrors still rejects the same name, with a real key in the environment.
    await expect(
      Agent.create({
        apiKey: apiKey(),
        model: { id: MODEL },
        tools: [
          {
            name: 'mcp_read_secret_number',
            description: 'x',
            inputSchema: z.object({}),
            handler: () => 'ok',
          },
        ],
        local: { cwd: process.cwd() },
      } as never),
    ).rejects.toThrow()
    console.log('[live] reserved-name rule confirmed against the real SDK with a live key')
  }, 60_000)
})
