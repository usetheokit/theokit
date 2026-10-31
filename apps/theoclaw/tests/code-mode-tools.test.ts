import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { createChannelAgentFactory, type CreateAgent } from '../src/control-plane/agent-factory.js'
import { codeModeTool } from '../src/tools/code-mode-tools.js'
import { vetoToolCall } from '../src/tools/path-veto.js'
import { controlAgentToolOptions, readOnlyTools } from '../src/tools/tool-registry.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { startModelStub } from './model-stub.js'

const enforced = () => ({ ok: true as const, bin: '/usr/bin/bwrap' })
const quiet = { warn: () => undefined }

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A workspace with the default (read-only) tools, a state file, and a file inside the tool root. */
function readOnlyWorkspace(): { readonly workspace: string; readonly settings: ToolSettings } {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  const workspace = handle.path
  mkdirSync(join(workspace, '.theoclaw'), { recursive: true })
  writeFileSync(join(workspace, '.theoclaw', 'x'), 'state')
  const settings = resolveToolSettings({}, workspace, { detect: enforced, ...quiet })
  writeFileSync(join(settings.toolRoot, 'notes.txt'), 'inside the root')
  return { workspace, settings }
}

describe('vetoToolCall', () => {
  it('vetoToolCall refuses a path into .theoclaw and passes a path in the tool root', () => {
    const { settings } = readOnlyWorkspace()

    expect(vetoToolCall('read_file', { path: '../.theoclaw/x' }, settings)).toMatch(/\.theoclaw/)
    expect(vetoToolCall('read_file', { path: 'notes.txt' }, settings)).toBeUndefined()
  })

  it('refuses a malformed argument instead of throwing', () => {
    const { settings } = readOnlyWorkspace()

    expect(vetoToolCall('read_file', { path: 'bad\u0000name' }, settings)).toMatch(/malformed/)
    expect(vetoToolCall('read_file', 'not an object', settings)).toMatch(/malformed/)
  })
})

/** A `/control` agent's tool by name, built over a worker factory the test controls. */
function controlTool(settings: ToolSettings, name: string, build: (options: AgentToolOptions) => Promise<TurnAgent>): CustomTool {
  const tool = controlAgentToolOptions(settings, build).tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`no ${name} tool on a /control agent`)
  return tool
}

const neverBuilt = (): Promise<TurnAgent> => Promise.reject(new Error('no worker expected'))

/**
 * A worker agent that answers `answer`, ends with status error (`fail`), or streams an error event
 * and still reports `finished` (`streamed-error`); it records its disposal.
 */
function fakeWorker(answer: string | 'fail' | 'streamed-error'): { agent: TurnAgent; disposed: () => boolean } {
  let disposed = false
  const agent = {
    send: async () => ({
      stream: async function* () {
        if (answer === 'streamed-error') yield { type: 'error', code: 'provider_overloaded' }
        yield { type: 'assistant' }
      },
      wait: async () => (answer === 'fail' ? { status: 'error' } : { status: 'finished', result: answer }),
      cancel: async () => {},
    }),
    [Symbol.asyncDispose]: async () => {
      disposed = true
    },
  }
  return { agent, disposed: () => disposed }
}

describe('run_code and delegate_all on a /control agent', () => {
  it('sends the model the script result and never the file contents', async () => {
    const { settings } = readOnlyWorkspace()
    const sentinel = `sentinel-${randomUUID()}`
    writeFileSync(join(settings.toolRoot, 'a.txt'), `${sentinel} 17`)
    writeFileSync(join(settings.toolRoot, 'b.txt'), `${sentinel} 25`)
    const code = [
      'const n = (file) => Number(file.content.trim().split(" ").pop())',
      'const a = await api.read_file({ path: "a.txt" })',
      'const b = await api.read_file({ path: "b.txt" })',
      'return { sum: n(a) + n(b) }',
    ].join('\n')
    const stub = await startModelStub([{ toolCalls: [{ name: 'run_code', args: { code } }] }, { text: 'the sum is 42' }])
    cleanups.push(() => void stub.close())
    const agent = await createTheoClawAgent(
      theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions: controlAgentToolOptions(settings, neverBuilt) }),
    )

    const run = await agent.send('add the numbers in a.txt and b.txt')
    await run.wait()
    await agent[Symbol.asyncDispose]()

    expect(stub.requests).toHaveLength(2)
    for (const request of stub.requests) expect(JSON.stringify(request)).not.toContain(sentinel)
    expect(JSON.stringify(stub.requests[1]?.messages)).toContain('{\\"sum\\":42}')
  })

  it('refuses a script call to a tool outside the allow-list', async () => {
    const { settings } = readOnlyWorkspace()
    const writeFile: CustomTool = {
      name: 'write_file',
      description: 'writes a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      handler: () => {
        writeFileSync(join(settings.toolRoot, 'written.txt'), 'x')
        return 'wrote'
      },
    }
    const tool = codeModeTool([...readOnlyTools(settings), writeFile], settings)

    const result = await tool.handler({
      code: 'try { await api.write_file({ path: "written.txt" }); return "wrote" } catch (e) { return e.message }',
    })

    expect(result).toContain("tool 'write_file' denied by permission gate: write_file is not one of the tools a script may call")
    expect(existsSync(join(settings.toolRoot, 'written.txt'))).toBe(false)
  })

  it('refuses a script call into the state directory', async () => {
    const { settings } = readOnlyWorkspace()
    const tool = controlTool(settings, 'run_code', neverBuilt)

    const handled = Promise.resolve(tool.handler({ code: 'return await api.read_file({ path: "../.theoclaw/x" })' }))

    await expect(handled).rejects.toThrow(/denied by permission gate: theoclaw: \.\.\/\.theoclaw\/x enters the workspace's \.theoclaw directory/)
  })

  it('answers a result over 16384 characters as an error naming its length', async () => {
    const { settings } = readOnlyWorkspace()
    const tool = controlTool(settings, 'run_code', neverBuilt)

    const handled = Promise.resolve(tool.handler({ code: 'return "x".repeat(16385)' }))
    const fits = await tool.handler({ code: 'return "x".repeat(16384)' })

    await expect(handled).rejects.toThrow("the script's result is 16385 characters, past the 16384")
    expect(fits).toHaveLength(16384)
  })

  it('builds each worker without run_code or delegate_all and disposes it', async () => {
    const { settings } = readOnlyWorkspace()
    const built: string[][] = []
    const workers: ReturnType<typeof fakeWorker>[] = []
    const tool = controlTool(settings, 'delegate_all', async (options) => {
      built.push(options.tools.map((candidate) => candidate.name))
      const worker = fakeWorker(`answer ${String(workers.length + 1)}`)
      workers.push(worker)
      return worker.agent
    })

    const answer = JSON.parse(
      String(await tool.handler({ tasks: [{ agent: 'worker', task: 'one' }, { agent: 'worker', task: 'two' }] })),
    ) as { results: { ok: boolean; response?: string }[] }

    expect(answer.results).toEqual([
      { agent: 'worker', ok: true, response: 'answer 1' },
      { agent: 'worker', ok: true, response: 'answer 2' },
    ])
    expect(built).toEqual([
      ['read_file', 'list_dir', 'web_fetch'],
      ['read_file', 'list_dir', 'web_fetch'],
    ])
    expect(workers.map((worker) => worker.disposed())).toEqual([true, true])
  })

  it('builds each worker with the state-directory veto plugin', async () => {
    const { settings } = readOnlyWorkspace()
    const plugins: string[][] = []
    const tool = controlTool(settings, 'delegate_all', async (options) => {
      plugins.push(options.plugins.map((plugin) => plugin.name))
      return fakeWorker('fine').agent
    })

    await tool.handler({ tasks: [{ agent: 'worker', task: 'one' }, { agent: 'worker', task: 'two' }] })

    expect(plugins).toEqual([['theoclaw-path-veto'], ['theoclaw-path-veto']])
  })

  it('reports a worker whose stream carries an error as delegation_failed even when wait() says finished', async () => {
    const { settings } = readOnlyWorkspace()
    const worker = fakeWorker('streamed-error')
    const tool = controlTool(settings, 'delegate_all', async () => worker.agent)

    const answer = JSON.parse(String(await tool.handler({ tasks: [{ agent: 'worker', task: 'one' }] }))) as {
      results: { ok: boolean; error?: string; message?: string }[]
    }

    expect(answer.results[0]).toMatchObject({ agent: 'worker', ok: false, error: 'delegation_failed' })
    expect(answer.results[0]?.message).toContain('provider_overloaded')
    expect(worker.disposed()).toBe(true)
  })

  it('reports a failing worker as delegation_failed beside a succeeding one', async () => {
    const { settings } = readOnlyWorkspace()
    const answers = ['fine', 'fail'] as const
    let next = 0
    const tool = controlTool(settings, 'delegate_all', async () => fakeWorker(answers[next++] ?? 'fail').agent)

    const answer = JSON.parse(
      String(await tool.handler({ tasks: [{ agent: 'worker', task: 'one' }, { agent: 'worker', task: 'two' }] })),
    ) as { results: { ok: boolean; error?: string }[] }

    expect(answer.results[0]).toEqual({ agent: 'worker', ok: true, response: 'fine' })
    expect(answer.results[1]).toMatchObject({ agent: 'worker', ok: false, error: 'delegation_failed' })
  })

  it('reports a worker that cannot be built, or fails to dispose, as delegation_failed', async () => {
    const { settings } = readOnlyWorkspace()
    let next = 0
    const tool = controlTool(settings, 'delegate_all', async () => {
      next += 1
      if (next === 1) throw new Error('no model key')
      const worker = fakeWorker('fine').agent
      return {
        ...worker,
        [Symbol.asyncDispose]: async () => {
          throw new Error('dispose failed')
        },
      }
    })

    const answer = JSON.parse(
      String(await tool.handler({ tasks: [{ agent: 'worker', task: 'one' }, { agent: 'worker', task: 'two' }] })),
    ) as { results: { ok: boolean; error?: string; message?: string }[] }

    expect(answer.results[0]).toMatchObject({ agent: 'worker', ok: false, error: 'delegation_failed' })
    expect(answer.results[0]?.message).toContain('no model key')
    expect(answer.results[1]).toMatchObject({ agent: 'worker', ok: false, error: 'delegation_failed' })
    expect(answer.results[1]?.message).toContain('dispose failed')
  })

  it('cancels every worker run and disposes it when the parent turn aborts', async () => {
    const { settings } = readOnlyWorkspace()
    const controller = new AbortController()
    const cancelled: boolean[] = []
    const disposed: boolean[] = []
    let sent = 0
    const tool = controlTool(settings, 'delegate_all', async () => {
      const index = cancelled.push(false) - 1
      disposed.push(false)
      let stop = (): void => undefined
      const stopped = new Promise<void>((resolve) => {
        stop = resolve
      })
      const run = {
        stream: async function* () {
          await stopped
        },
        wait: async () => {
          await stopped
          return { status: 'cancelled' }
        },
        cancel: async () => {
          cancelled[index] = true
          stop()
        },
      }
      return {
        send: async () => {
          sent += 1
          if (sent === 2) controller.abort()
          return run
        },
        [Symbol.asyncDispose]: async () => {
          disposed[index] = true
        },
      }
    })
    const tasks = [{ agent: 'worker', task: 'one' }, { agent: 'worker', task: 'two' }]

    const answer = JSON.parse(String(await tool.handler({ tasks }, { signal: controller.signal }))) as {
      results: { ok: boolean; error?: string }[]
    }

    expect(cancelled).toEqual([true, true])
    expect(disposed).toEqual([true, true])
    expect(answer.results.map((entry) => entry.error)).toEqual(['delegation_failed', 'delegation_failed'])
  })

  it('builds no worker for a task whose turn already aborted', async () => {
    const { settings } = readOnlyWorkspace()
    let built = 0
    const tool = controlTool(settings, 'delegate_all', async () => {
      built += 1
      return fakeWorker('fine').agent
    })

    const handled = tool.handler({ tasks: [{ agent: 'worker', task: 'one' }] }, { signal: AbortSignal.abort() })
    const answer = JSON.parse(String(await handled)) as { results: { ok: boolean; error?: string }[] }

    expect(built).toBe(0)
    expect(answer.results[0]).toMatchObject({ ok: false, error: 'delegation_failed' })
  })

  it('stops a script and its host call when the parent turn aborts', async () => {
    const { settings } = readOnlyWorkspace()
    const controller = new AbortController()
    let toolSignal: AbortSignal | undefined
    const webFetch: CustomTool = {
      name: 'web_fetch',
      description: 'fetches a url',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      handler: (_input, ctx) => {
        toolSignal = ctx?.signal
        setImmediate(() => {
          controller.abort()
        })
        return new Promise<never>(() => undefined)
      },
    }
    const tool = codeModeTool([webFetch], settings)
    const started = Date.now()

    const code = 'return await api.web_fetch({ url: "https://example.com" })'
    const handled = Promise.resolve(tool.handler({ code }, { signal: controller.signal }))

    await expect(handled).rejects.toThrow(/cancelled/)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(toolSignal?.aborted).toBe(true)
  })

  it('gives chat agents no tool', async () => {
    const seen: Parameters<CreateAgent>[0][] = []
    const factory = createChannelAgentFactory({ THEOCLAW_MODEL: 'openrouter/m', THEOKIT_API_KEY: 'k' }, async (options) => {
      seen.push(options)
      return fakeWorker('unused').agent
    })

    await factory()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.tools ?? []).toHaveLength(0)
  })
})
