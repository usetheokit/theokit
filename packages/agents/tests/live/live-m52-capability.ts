/**
 * M52 LIVE proof — an agent authored ENTIRELY by capabilities (including the FILE/registry route)
 * reaches a real provider and answers. Run inside tmux `agentbuilder`:
 *
 *   node --env-file=<agent-builder>/.env node_modules/tsx/dist/cli.mjs packages/agents/tests/live/live-m52-capability.ts
 *
 * Prints (a) which env key is present — never its value, (b) the deep-equal check against the
 * existing `defineAgent` path, (c) the REAL streamed answer from the provider.
 */
import { isDeepStrictEqual } from 'node:util'

import { Agent } from '@theokit/sdk'

import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'
import { buildModelSelection } from '../../src/bridge/model-selection.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import { ModelCapability, skills } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { CapabilityRegistry } from '../../src/capability/registry.js'

const MODEL = process.env.LIVE_MODEL ?? 'google/gemini-2.5-flash-lite'

function keyPresence(): string {
  const names = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY']
  const present = names.filter((n) => (process.env[n] ?? '').length > 0)
  return present.length > 0 ? present.join(', ') : '(none)'
}

function apiKey(): string {
  for (const n of [
    'OPENROUTER_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'THEOKIT_API_KEY',
  ]) {
    const v = process.env[n]
    if (v !== undefined && v.length > 0) return v
  }
  throw new Error('no provider key present in the environment')
}

/** Chave com valor `undefined` ≡ chave ausente para `Agent.create`; normaliza os dois lados. */
function dropUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}

function waistOf(draft: Record<string, unknown>): Record<string, unknown> {
  const { provenance: _p, ...waist } = draft
  return waist
}

async function main(): Promise<void> {
  console.error(`[live] provider key present: ${keyPresence()}`)
  console.error(`[live] model: ${MODEL}`)

  // (1) FILE-BASED authoring — exactly what a `.theokit/config` would carry. No decorators, no classes
  //     authored by the user: names + args resolved through the registry.
  const configFromFile = [
    { name: 'model', arg: MODEL },
    { name: 'skills', arg: ['code-review'] },
  ]
  const registry = new CapabilityRegistry()
    .register('model', (id) => new ModelCapability(id as string))
    .register('skills', (names) => skills(names as string[]))
  const draft = applyCapabilities(configFromFile.map((c) => registry.resolve(c.name, c.arg)))

  // (2) Equivalence against the EXISTING authoring path, live (not only in unit tests).
  const reference = compileAgentDefinition(defineAgent({ model: MODEL, skills: ['code-review'] }))
  const waist = waistOf(draft as unknown as Record<string, unknown>)
  // O contrato é EQUIVALÊNCIA SEMÂNTICA, não ordem de chaves: nada no pacote serializa ou
  // hasheia as opções compiladas (`Object.keys` só aparece sobre valores aninhados —
  // sdk-adapter-create-options.ts:76,91), então a ordem de chave de topo não é observável.
  const identical = isDeepStrictEqual(dropUndefined(waist), dropUndefined(reference))
  const sameOrder = JSON.stringify(waist) === JSON.stringify(reference)
  console.error(`[live] waist deep-equal to defineAgent path: ${identical ? 'YES' : 'NO'}`)
  console.error(
    `[live] (key order also identical: ${sameOrder ? 'YES' : 'NO'} — not part of the contract)`,
  )
  console.error(`[live] provenance: ${JSON.stringify(draft.provenance)}`)
  if (!identical) {
    console.error(`[live]   capability: ${JSON.stringify(waist)}`)
    console.error(`[live]   defineAgent: ${JSON.stringify(reference)}`)
    process.exitCode = 1
    return
  }

  // (3) The SHARED projection turns the capability waist into real Agent.create options — exactly
  //     as `sdk-adapter.ts:669` does: `assembleM8CreateOptions` covers the M8 extras (skills,
  //     settingSources, memory, mcp…) and `buildModelSelection` covers the model. It is a PARTIAL
  //     projection by design, so the live path composes both instead of assuming one carries all.
  const { options, applied } = assembleM8CreateOptions(waist as never)
  console.error(`[live] adapter applied: ${applied.join(', ')}`)

  await using agent = await Agent.create({
    ...options,
    model: buildModelSelection(draft.model, draft.reasoningEffort),
    apiKey: apiKey(),
    local: { ...(options as { local?: object }).local, cwd: process.cwd() },
  } as never)

  const run = await agent.send('Answer with exactly one word: what is 2+2 in English?')
  let answer = ''
  for await (const event of run.stream()) {
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          answer += block.text
          process.stdout.write(block.text)
        }
      }
    }
  }
  process.stdout.write('\n')
  const result = await run.wait()
  console.error(`[live] run status: ${result.status}`)
  if (result.status !== 'finished') {
    console.error(`[live] result: ${JSON.stringify(result).slice(0, 600)}`)
  }
  console.error(`[live] answer non-empty: ${answer.trim().length > 0 ? 'YES' : 'NO'}`)
  if (result.status !== 'finished' || answer.trim().length === 0) process.exitCode = 1
}

await main()
