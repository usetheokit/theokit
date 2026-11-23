import { Agent } from '@theokit/sdk'
import { startScriptedModelServer, type ScriptedStep } from '@theokit/sdk/testing'
import { describe, expect, it } from 'vitest'

import { LOOP_REPEAT_LIMIT, LOOP_WINDOW, untrustedContentSendOptions } from '../src/agent/untrusted-content.js'

// The repeat guard is the SDK's window guard (`sendDefaults.doomLoop`), set once for every agent (#2702).
// These tests run a real SDK agent against a scripted model with the app's send defaults.

const call = (input: Record<string, unknown>, name = 'probe'): ScriptedStep => ({ toolCalls: [{ name, input }] })

async function run(steps: readonly ScriptedStep[]): Promise<{ executed: string[]; toolResults: string[]; stopped: boolean | undefined }> {
  const server = await startScriptedModelServer({ steps })
  const executed: string[] = []
  try {
    const tool = (name: string) => ({
      name,
      description: name,
      inputSchema: { type: 'object' as const },
      handler: (input: Record<string, unknown>) => {
        executed.push(`${name}:${JSON.stringify(input)}`)
        return `ok ${executed.length}`
      },
    })
    const agent = await Agent.create({
      apiKey: 'local',
      model: server.model,
      local: { cwd: process.cwd() },
      tools: [tool('probe'), tool('other')],
      sendDefaults: untrustedContentSendOptions(),
    })
    const result = await (await agent.send('go', { maxIterations: 60 })).wait()
    const toolResults = server.requests.flatMap((request) =>
      request.messages.filter((message) => message.role === 'tool').map((message) => JSON.stringify(message.content)),
    )
    return { executed, toolResults, stopped: (result as { stoppedByDoomLoop?: boolean }).stoppedByDoomLoop }
  } finally {
    await server.close()
  }
}

describe('loop detection (SDK window guard)', () => {
  it('carries limit 3 and window 20 in the send defaults', () => {
    expect(untrustedContentSendOptions().doomLoop).toEqual({ window: LOOP_WINDOW, windowRepeatLimit: LOOP_REPEAT_LIMIT })
    expect([LOOP_REPEAT_LIMIT, LOOP_WINDOW]).toEqual([3, 20])
  })

  it('runs three identical calls and blocks the fourth with a stated reason, then the run continues', async () => {
    const same = { path: 'a.txt' }
    const { executed, toolResults } = await run([call(same), call(same), call(same), call(same), call({ path: 'b.txt' }), { text: 'done' }])
    expect(executed.filter((entry) => entry === `probe:${JSON.stringify(same)}`)).toHaveLength(3)
    expect(executed).toContain('probe:{"path":"b.txt"}')
    expect(toolResults.some((content) => /Blocked: `probe` was already called 3 times/.test(content))).toBe(true)
  })

  it('lets different arguments and different tools through', async () => {
    const steps: ScriptedStep[] = []
    for (let i = 0; i < 6; i++) steps.push(call({ path: `${i}` }))
    for (let i = 0; i < 3; i++) steps.push(call({ path: 'a' }, 'other'))
    steps.push({ text: 'done' })
    const { executed, toolResults } = await run(steps)
    expect(executed).toHaveLength(9)
    expect(toolResults.some((content) => /Blocked:/.test(content))).toBe(false)
  })

  it('forgets calls that left the window', async () => {
    const same = { path: 'a.txt' }
    const steps: ScriptedStep[] = [call(same), call(same), call(same)]
    for (let i = 0; i < LOOP_WINDOW; i++) steps.push(call({ path: `${i}` }, i % 2 === 0 ? 'probe' : 'other'))
    steps.push(call(same), { text: 'done' })
    const { executed, toolResults } = await run(steps)
    expect(executed.filter((entry) => entry === `probe:${JSON.stringify(same)}`)).toHaveLength(4)
    expect(toolResults.some((content) => /Blocked:/.test(content))).toBe(false)
  })
})
