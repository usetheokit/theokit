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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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
  async function turn(
    memory: { enabled: boolean } | undefined,
    message: string,
    extra: { baseDir?: string } = {},
  ): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), 'theokit-memory-'))
    workspaces.push(cwd)
    let builder = AgentBuilder.create().model('ollama/llama3.2').system('You answer briefly.')
    if (memory !== undefined) builder = builder.memory(memory)
    const compiled = compileAgentDefinition(builder.build())
    // `'local'` is the sentinel a keyless provider resolves to — see `KEYLESS_API_KEY` in
    // `provider-resolver.ts`. `cwd` is what `mountAgent` threads from the app root.
    const events = createSdkAgentStream(compiled, compiled.tools, 'local', { cwd, ...extra })
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
   * WHERE it lands, not just that it lands — the assertion this file was missing (#557).
   *
   * `mountAgent` sets `baseDir` unconditionally, to root the session transcript under the app's
   * `.data/`. From `@theokit/sdk` 4.61 the SDK derives its MEMORY root from that same field
   * (`memoryHome = explicitSessionDir(local)`), so `MEMORY.md` moves to
   * `<baseDir>/projects/<encoded-cwd>/memory/` while `.index/` and `sessions/` stay under
   * `<cwd>/.theokit/memory/` — the store looks alive and the capture looks broken. That is the
   * whole of #557, and it cannot be fixed from this side: one SDK field governs both roots, and its
   * docstring says "Only transcripts are written here" (usetheokit/theokit-sdk#463).
   *
   * The assertion is deliberately "written SOMEWHERE findable", not "written HERE". The location
   * genuinely differs across the SDK range this package supports — at the `^4.52.1` floor there is
   * no relocation, from 4.61 there is — so pinning either path makes the suite report the resolved
   * lockfile rather than the framework. What must never happen, in any version, is the phrase being
   * captured and stored nowhere, which is what a consumer experiences.
   *
   * It prints where it found it, because that is the fact a reader of a failure needs.
   */
  it('memory is written somewhere findable when the mount roots the transcript (#557)', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'theokit-transcript-'))
    workspaces.push(baseDir)

    const cwd = await turn({ enabled: true }, CAPTURE, { baseDir })

    const documented = join(cwd, '.theokit', 'memory', 'MEMORY.md')
    const projects = join(baseDir, 'projects')
    const relocated = existsSync(projects)
      ? readdirSync(projects, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(projects, e.name, 'memory', 'MEMORY.md'))
          .filter((f) => existsSync(f))
      : []

    const found = existsSync(documented) ? [documented] : relocated
    expect(
      found.length,
      'the capture phrase was accepted and MEMORY.md exists nowhere — neither under the documented ' +
        '`<cwd>/.theokit/memory/` nor under the transcript root. That is #557 as a consumer meets it.',
    ).toBeGreaterThan(0)

    // Not an assertion: a reader of a future failure needs to know which root answered.
    console.info(
      `[#557] MEMORY.md found under ${existsSync(documented) ? '<cwd>/.theokit/memory' : '<baseDir>/projects/<encoded-cwd>/memory'}`,
    )
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
