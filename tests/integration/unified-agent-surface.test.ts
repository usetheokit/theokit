/**
 * M2 (theokit-ai-first) — end-to-end integration for the `agents/*.ts` convention.
 *
 * Proves the whole chain deterministically, through the REAL ai-sdk consumer, with NO live
 * LLM (the SDK boundary `createSdkAgentStream` is stubbed to echo):
 *
 *   agents/echo.ts on disk
 *     → generateManifest(serverDir, projectRoot)         [scan: file is discoverable]
 *     → dynamic import of the file                        [the module the prod loader loads]
 *     → mountAgent(mod, request, apiKey)                  [the single dev+prod wiring point]
 *     → Response on the UIMessageStream wire
 *     → ai's readUIMessageStream                          [the exact path useChat runs]
 *     → reconstructed assistant text
 *
 * This is the parity guard (EC-4): the same `mountAgent` serves dev and the built server, so
 * proving it here proves both. The prod branch (`tryServeAgent`) + dev middleware register the
 * same call; the wire correctness is what this asserts.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(__dirname, '../..')

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Stub the SDK runtime boundary (the module `streamAgentUIMessages` calls internally): echo
// the message back as a text delta + done. Keeps the whole chain real EXCEPT the LLM call.
vi.mock('../../packages/agents/src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (message: string): AsyncIterable<{ type: string; [k: string]: unknown }> => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', content: `Echo: ${message}` }
        yield {
          type: 'done',
          result: `Echo: ${message}`,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
        }
      },
    }),
}))

const { generateManifest } = await import('../../packages/theo/src/server/scan/manifest.js')
const { mountAgent } = await import('../../packages/theo/src/server/agent/mount-agent.js')
const { consumeUIMessageStream } =
  await import('../../packages/theo/src/client/consume-ui-message-stream.js')

let projectDir: string

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'theokit-m2-e2e-'))
  mkdirSync(join(projectDir, 'agents'), { recursive: true })
  mkdirSync(join(projectDir, 'server', 'routes'), { recursive: true })
  // Resolve the agent file's imports as a real app would: @theokit/agents (workspace
  // package; its Symbol.for brand matches the src instance mountAgent uses) + zod.
  mkdirSync(join(projectDir, 'node_modules', '@theokit'), { recursive: true })
  symlinkSync(
    resolve(REPO, 'packages/agents'),
    join(projectDir, 'node_modules', '@theokit', 'agents'),
    'dir',
  )
  symlinkSync(resolve(REPO, 'node_modules/zod'), join(projectDir, 'node_modules', 'zod'), 'dir')
  // A real zero-config agent file — the convention's whole surface.
  writeFileSync(
    join(projectDir, 'agents', 'echo.ts'),
    [
      `import { defineAgent } from '@theokit/agents'`,
      `import { z } from 'zod'`,
      `export default defineAgent({`,
      `  input: z.object({ message: z.string() }),`,
      `  model: 'test-model',`,
      `  system: 'echo',`,
      `})`,
      ``,
    ].join('\n'),
  )
})

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('agents/*.ts convention — end to end (M2)', () => {
  it('test_agent_file_is_discovered_in_manifest', () => {
    const manifest = generateManifest(join(projectDir, 'server'), projectDir)
    expect(manifest.agents).toBeDefined()
    const echo = manifest.agents!.find((a) => a.name === 'echo')
    expect(echo).toBeDefined()
    expect(echo!.agentPath).toBe('/api/agents/echo')
  })

  it('test_convention_serves_uimessagestream_parsed_by_ai_consumer', async () => {
    // Load the on-disk module exactly as the prod loader (tsx) would.
    const mod = (await import(join(projectDir, 'agents', 'echo.ts'))) as unknown

    const request = new Request('http://localhost/api/agents/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })

    const response = await mountAgent(mod, request, 'sk-test', 'agents/echo.ts')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')

    // Consume with the REAL ai reader (the useChat path) — reconstruct the assistant text.
    let finalText = ''
    await consumeUIMessageStream(response, (message) => {
      finalText = message.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
    })
    expect(finalText).toBe('Echo: hi')
  })
})
