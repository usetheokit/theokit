/**
 * An A2A call reaches a real model through the route the framework serves.
 *
 * `createA2ATool` delegates a message to a remote agent. The unit tests put it in front of a
 * scripted run; this test puts it in front of a route whose answer comes from a real provider, so
 * the bytes the client reads are the bytes a deployed agent writes. It imports `@theokit/agents`
 * the way TheoCode does, through the package's build, never through `src/`.
 *
 * The route handler is a Web `Request -> Response` function, so the tool's `fetchImpl` calls it in
 * process; only the model call leaves the machine.
 *
 * Skips, never fails, when no provider key is set: a machine without a credential is not a machine
 * with a defect. Prints the NAME of the key it used, never its value. When `A2A_LIVE_TRANSCRIPT`
 * names a path, the transcript is written there with every occurrence of the key replaced, because
 * the JSON reporter keeps no console output and the reply has to be readable after the run.
 */
import { writeFileSync } from 'node:fs'

import { createA2ATool } from '@theokit/agents'
import {
  createSdkAgentStream,
  generateAgentRoutes,
  type CompiledAgentOptions,
} from '@theokit/agents/bridge'
import { afterAll, describe, expect, it } from 'vitest'

const MODEL = process.env.LIVE_MODEL ?? 'google/gemini-2.5-flash-lite'
const KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY']

function selectedKeyName(): string {
  const name = KEYS.find((n) => (process.env[n] ?? '').length > 0)
  if (name === undefined) throw new Error('no provider key present in the environment')
  return name
}

function apiKey(): string {
  return process.env[selectedKeyName()] ?? ''
}

const HAS_KEY = KEYS.some((n) => (process.env[n] ?? '').length > 0)

const transcript: string[] = []

function log(line: string): void {
  transcript.push(line)
  console.log(line)
}

afterAll(() => {
  const path = process.env.A2A_LIVE_TRANSCRIPT
  if (path === undefined || path.length === 0 || !HAS_KEY) return
  const key = apiKey()
  const marker = `[REDACTED:${selectedKeyName()}]`
  let redactions = 0
  const lines = transcript.map((line) => {
    const parts = line.split(key)
    redactions += parts.length - 1
    return parts.join(marker)
  })
  writeFileSync(path, `${lines.join('\n')}\n[live] redactions: ${redactions}\n`)
})

describe.skipIf(!HAS_KEY)('an A2A call against a route answered by a real model', () => {
  it('test_an_a2a_call_reaches_a_real_model', async () => {
    const compiled: CompiledAgentOptions = {
      model: MODEL,
      systemPrompt: 'Answer in one short sentence.',
      tools: [],
      agents: {},
      stream: true,
    }
    const routes = generateAgentRoutes({
      walkResult: { route: '/api/agents/remote' },
      compiledOptions: compiled,
      createRun: createSdkAgentStream(compiled, [], () => apiKey()),
    })
    const chat = routes.find((r) => r.method === 'POST')
    if (chat === undefined) throw new Error('generateAgentRoutes mounted no POST route')

    const tool = createA2ATool({
      url: `https://remote.local${chat.path}`,
      name: 'ask_remote',
      description: 'Ask the remote agent',
      fetchImpl: (url, init) => chat.handler(new Request(url, init)),
    })

    log(`[live] provider key used: ${selectedKeyName()}`)
    log(`[live] model: ${MODEL}`)
    const reply = await tool.handler({ message: 'Reply with exactly: A2A READY' })
    if (typeof reply !== 'string') throw new Error('the A2A tool returned content blocks, not text')
    log(`[live] reply: ${reply}`)

    expect(reply.trim().length).toBeGreaterThan(0)
    expect(reply.toUpperCase()).toContain('A2A READY')
    expect(transcript.some((l) => l.includes(apiKey()))).toBe(false)
  }, 180_000)
})
