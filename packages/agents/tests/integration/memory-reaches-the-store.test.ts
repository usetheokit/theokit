/**
 * `.memory({ enabled: true })` on the builder must reach the SDK's durable store — not just the
 * options object (usetheokit/theokit#557).
 *
 * The report said the setting was inert through the framework: the SDK wrote `MEMORY.md` for the
 * same configuration and the framework wrote only a session transcript. Measured here, the
 * framework path DOES write it — what differed was the capture phrase, which the SDK's pattern
 * widened between the two versions compared. That makes this file a regression test rather than a
 * fix, and it is the assertion the report asked for: after ONE request carrying the capture phrase,
 * against a stubbed provider, the store holds a memory a human can read.
 *
 * It is worth owning because the projection HAS been inert before — `assembleM8CreateOptions`
 * carries a note about `@MCP` compiling into a field nobody forwarded (#89), and `memory` had no
 * test at any layer until this one. A capability whose failure mode is silence needs a test that
 * looks at the filesystem, not at an options bag: asserting `options.memory === {enabled:true}`
 * would have passed for every version of the bug the report describes.
 *
 * Deliberately NOT mocking `@theokit/sdk`, unlike its neighbours in this directory. The whole
 * question is what the SDK does with what it was handed, so a stubbed SDK answers a different one.
 * The provider is what gets stubbed instead: an Ollama-shaped NDJSON responder on loopback, so the
 * test needs no credential and no network.
 */
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'

/**
 * The phrase without a qualifier — `Remember: <fact>` — because it is the ONE form every SDK
 * version in the supported range captures. `Remember (project): <fact>` is accepted from 4.61.0 and
 * silently ignored by 4.52.x, the floor this package declares, so pinning the test to it would make
 * the suite report a framework defect whenever the resolved SDK sits at the floor.
 */
const CAPTURE = 'Remember: deploys go through the release branch'

/** Ollama's `/api/chat` NDJSON shape — one content delta, then the terminal frame. */
function ollamaStub(): Server {
  return createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(
        `${JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: 'Noted.' }, done: false })}\n`,
      )
      res.write(
        `${JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' })}\n`,
      )
      res.end()
    })
  })
}

describe('durable memory declared on the builder reaches the store (#557)', () => {
  let server: Server
  let previousHost: string | undefined
  const workspaces: string[] = []

  beforeAll(async () => {
    server = ollamaStub()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('stub did not bind a port')
    previousHost = process.env.OLLAMA_HOST
    process.env.OLLAMA_HOST = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (previousHost === undefined) delete process.env.OLLAMA_HOST
    else process.env.OLLAMA_HOST = previousHost
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  /** Runs one turn through the same seam `mountAgent` uses, rooted at a throwaway workspace. */
  async function turn(memory: { enabled: boolean } | undefined, message: string): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), 'theokit-memory-'))
    workspaces.push(cwd)
    let builder = AgentBuilder.create().model('ollama/llama3.2').system('You answer briefly.')
    if (memory !== undefined) builder = builder.memory(memory)
    const compiled = compileAgentDefinition(builder.build())
    // `'local'` is the sentinel a keyless provider resolves to — see `KEYLESS_API_KEY` in
    // `provider-resolver.ts`. `cwd` is what `mountAgent` threads from the app root.
    const events = createSdkAgentStream(compiled, compiled.tools, 'local', { cwd })
    for await (const _event of events(message, `session-${workspaces.length}`)) {
      // drain — the turn is what triggers the capture
    }
    return cwd
  }

  it('writes MEMORY.md a human can read after one capture request', async () => {
    const cwd = await turn({ enabled: true }, CAPTURE)

    const memoryMd = join(cwd, '.theokit', 'memory', 'MEMORY.md')
    expect(existsSync(memoryMd)).toBe(true)
    expect(readFileSync(memoryMd, 'utf8')).toContain('deploys go through the release branch')
  }, 60_000)

  /**
   * The load-bearing half. Without it the first case would still pass if the SDK wrote MEMORY.md
   * unconditionally, and the assertion would prove nothing about the setting being honoured.
   */
  it('writes nothing durable when the agent did not declare memory', async () => {
    const cwd = await turn(undefined, CAPTURE)

    expect(existsSync(join(cwd, '.theokit', 'memory', 'MEMORY.md'))).toBe(false)
  }, 60_000)
})
