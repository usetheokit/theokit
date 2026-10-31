import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import OpenAI from 'openai'
import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import type { RunningTheoClaw } from '../src/composition.js'
import { createTheoClawApi, validateToolArgs } from '../src/http-api/api-routes.js'
import { vetoToolCall } from '../src/tools/path-veto.js'
import { type AgentToolOptions, agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { assistant, FakeAgent, finished } from './fakes.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { startModelStub } from './model-stub.js'
import { CONTROL_TOKEN, startForTools, stop, type ToolStart } from './tool-start-fixtures.js'

const enforced = () => ({ ok: true as const, bin: '/usr/bin/bwrap' })
const quiet = { warn: () => undefined }

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function toolSettings(hostTools: boolean): ToolSettings {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  mkdirSync(join(handle.path, '.theoclaw'), { recursive: true })
  return resolveToolSettings(hostTools ? { THEOCLAW_HOST_TOOLS: 'on' } : {}, handle.path, { detect: enforced, ...quiet })
}

describe('vetoToolCall', () => {
  it('is the plugin judgement: a refusal for the state directory, nothing for the tool root', () => {
    const settings = toolSettings(false)

    expect(vetoToolCall('read_file', { path: '../.theoclaw/x' }, settings)).toMatch(/^theoclaw: .*\.theoclaw directory$/)
    expect(vetoToolCall('read_file', { path: 'notes.txt' }, settings)).toBeUndefined()
    expect(vetoToolCall('read_file', { paths: 'x' }, settings)).toMatch(/^theoclaw: refused a malformed tool call: .*paths must be an array/)
  })
})

const API_PATHS = ['/v1/models', '/v1/chat/completions', '/tools/invoke'] as const
const HOST_TOOLS = ['write_file', 'edit_file', 'apply_patch', 'shell_exec'] as const

/** A start on a host-tools-capable workspace, stopped after the test; `hostTools` switches them. */
async function startApi(options: {
  readonly hostTools?: boolean
  readonly token?: string | undefined
  readonly agentFactory?: (toolOptions: AgentToolOptions) => unknown
}): Promise<ToolStart & { readonly workspace: string; readonly base: string }> {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  mkdirSync(join(handle.path, '.theoclaw'), { recursive: true })
  const env = {
    THEOCLAW_CONTROL_TOKEN: 'token' in options ? options.token : CONTROL_TOKEN,
    ...(options.hostTools === true ? { THEOCLAW_HOST_TOOLS: 'on' } : {}),
  }
  const extra = options.agentFactory === undefined ? {} : { agentFactory: options.agentFactory as never }
  const start = await startForTools(env, handle.path, { detect: enforced }, extra)
  const app = start.app as RunningTheoClaw | undefined
  if (app === undefined) throw new Error(`the start refused: ${start.error?.message ?? 'unknown'}`)
  pendingStops.push(() => stop(start))
  const { host, port } = app.address()
  return { ...start, workspace: handle.path, base: `http://${host}:${port}` }
}

const pendingStops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stopOne of pendingStops.splice(0)) await stopOne()
})

function bearer(token = CONTROL_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function invoke(base: string, tool: string, args: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/tools/invoke`, { method: 'POST', headers: bearer(), body: JSON.stringify({ tool, args }) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

function errorType(body: Record<string, unknown>): unknown {
  return (body.error as { type?: unknown } | undefined)?.type
}

describe('createTheoClawApi, the token gate', () => {
  function gate(agentsBuilt: { count: number }) {
    return createTheoClawApi({
      token: CONTROL_TOKEN,
      model: 'test-model',
      withAgent: async () => {
        agentsBuilt.count += 1
        throw new Error('no agent in the gate tests')
      },
      toolSettings: toolSettings(false),
      stderr: () => undefined,
    })
  }

  it('answers 401 without the bearer token and builds no agent', async () => {
    const built = { count: 0 }
    const api = gate(built)

    for (const path of API_PATHS) {
      const response = await api(new Request(`http://127.0.0.1${path}`, { method: 'POST', body: '{}' }))
      expect(response?.status, path).toBe(401)
      expect(errorType((await response?.json()) as Record<string, unknown>)).toBe('unauthorized')
    }
    expect(built.count).toBe(0)
  })

  it('answers 401 with a wrong bearer token', async () => {
    const response = await gate({ count: 0 })(
      new Request('http://127.0.0.1/v1/models', { headers: { authorization: `Bearer ${'x'.repeat(40)}` } }),
    )

    expect(response?.status).toBe(401)
  })

  it('answers 401 without reading the request body', async () => {
    let pulled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true
        controller.close()
      },
    }, { highWaterMark: 0 }) // 0: nothing is pulled until someone reads
    const request = new Request('http://127.0.0.1/v1/chat/completions', { method: 'POST', body, duplex: 'half' } as RequestInit)

    const response = await gate({ count: 0 })(request)

    expect(response?.status).toBe(401)
    expect(pulled).toBe(false)
  })

  it('accepts a lowercase bearer scheme', async () => {
    const response = await gate({ count: 0 })(
      new Request('http://127.0.0.1/v1/models', { headers: { authorization: `bearer ${CONTROL_TOKEN}` } }),
    )

    expect(response?.status).toBe(200)
  })

  it('answers undefined for a path that is not the API', async () => {
    expect(await gate({ count: 0 })(new Request('http://127.0.0.1/health'))).toBeUndefined()
  })
})

describe('the API in the started process', () => {
  it('answers 404 on every API path when the control token is unset', async () => {
    const { base } = await startApi({ token: undefined })

    for (const path of API_PATHS) {
      const response = await fetch(`${base}${path}`, { method: path === '/v1/models' ? 'GET' : 'POST', headers: bearer(), body: path === '/v1/models' ? null : '{}' })
      expect(response.status, path).toBe(404)
    }
  })

  it('answers a chat completion from one turn against the model stub', async () => {
    const stub = await startModelStub([{ text: 'pong from the stub' }])
    cleanups.push(() => void stub.close())
    const { base } = await startApi({
      agentFactory: (toolOptions) =>
        createTheoClawAgent(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions })),
    })
    const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: CONTROL_TOKEN })

    const completion = await client.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'ping' }] })

    expect(completion.choices[0]?.message.content).toBe('pong from the stub')
    expect(stub.requests).toHaveLength(1)
    const models = await client.models.list()
    expect(models.data.map((model) => model.id)).toEqual(['test-model'])
  })

  it('answers 502 turn_failed and writes the reason to stderr when the turn fails', async () => {
    const start = await startApi({ agentFactory: () => ({ send: () => Promise.reject(new Error('provider said no')) }) })

    const response = await fetch(`${start.base}/v1/chat/completions`, {
      method: 'POST',
      headers: bearer(),
      body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'x' }] }),
    })

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('provider said no')
    expect(start.output()).toContain('theoclaw: http api turn failed: provider said no')
  })

  it('answers an empty assistant content when the turn emits no text_delta', async () => {
    const { base } = await startApi({ agentFactory: () => new FakeAgent({ frames: [finished()] }) })
    const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: CONTROL_TOKEN })

    const completion = await client.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'x' }] })

    expect(completion.choices[0]?.message.content).toBe('')
  })

  it('joins the text of every text_delta into the assistant content', async () => {
    const { base } = await startApi({ agentFactory: () => new FakeAgent({ frames: [assistant('a'), assistant('b'), finished()] }) })
    const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: CONTROL_TOKEN })

    const completion = await client.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'x' }] })

    expect(completion.choices[0]?.message.content).toBe('ab')
  })

  it('answers 404 for shell when host tools are off', async () => {
    const off = await startApi({ hostTools: false })
    const on = await startApi({ hostTools: true })

    expect((await invoke(off.base, 'shell_exec', {})).status).toBe(404)
    const withHostTools = await invoke(on.base, 'shell_exec', {})
    expect(withHostTools.status).toBe(400)
    expect(errorType(withHostTools.body)).toBe('invalid_args')
  })

  it.each([false, true])('exposes exactly the control tool set over HTTP (host tools %s)', async (hostTools) => {
    const start = await startApi({ hostTools })
    const names = agentToolOptions(toolSettings(hostTools)).tools.map((tool) => tool.name)

    for (const name of names) expect((await invoke(start.base, name, {})).status, name).not.toBe(404)
    if (!hostTools) for (const name of HOST_TOOLS) expect((await invoke(start.base, name, {})).status, name).toBe(404)
  })

  it('refuses a path into the state directory with 403', async () => {
    const { base, workspace } = await startApi({})
    writeFileSync(join(workspace, '.theoclaw', 'x'), 'state')

    const { status, body } = await invoke(base, 'read_file', { path: '../.theoclaw/x' })

    expect(status).toBe(403)
    expect(errorType(body)).toBe('refused')
    expect(JSON.stringify(body)).not.toContain('state')
  })

  it('refuses a symlink into the state directory with 403', async () => {
    const { base, workspace } = await startApi({})
    writeFileSync(join(workspace, '.theoclaw', 'x'), 'secret-state')
    symlinkSync('../.theoclaw', join(workspace, 'files', 'state'))

    const { status, body } = await invoke(base, 'read_file', { path: 'state/x' })

    expect(status).toBe(403)
    expect(JSON.stringify(body)).not.toContain('secret-state')
  })

  it('allows a dot-directory inside the tool root', async () => {
    const { base, workspace } = await startApi({})
    mkdirSync(join(workspace, 'files', '.theoclaw'), { recursive: true })
    writeFileSync(join(workspace, 'files', '.theoclaw', 'x'), 'inside the root')

    const { status, body } = await invoke(base, 'read_file', { path: '.theoclaw/x' })

    expect(status).not.toBe(403)
    expect(status).toBe(200)
    expect(JSON.stringify(body)).toContain('inside the root')
  })

  it('refuses a malformed paths argument with 403', async () => {
    const { base } = await startApi({})

    const { status, body } = await invoke(base, 'read_file', { paths: 'x' })

    expect(status).toBe(403)
    expect(String((body.error as { message?: unknown }).message)).toContain('paths must be an array')
  })

  it('answers 400 invalid_args for a todolist call its schema refuses', async () => {
    const { base } = await startApi({})

    const { status, body } = await invoke(base, 'todolist', { action: 7 })

    expect(status).toBe(400)
    expect(errorType(body)).toBe('invalid_args')
  })

  it('builds a fresh todolist per request', async () => {
    const { base } = await startApi({})

    const added = await invoke(base, 'todolist', { action: 'add', title: 'first' })
    const listed = await invoke(base, 'todolist', { action: 'list' })

    expect(added.status).toBe(200)
    expect(listed.status).toBe(200)
    expect(JSON.stringify(listed.body.result)).not.toContain('first')
  })
})

describe('validateToolArgs', () => {
  const fake = (inputSchema: Record<string, unknown>): CustomTool => ({ name: 'fake', description: 'fake', inputSchema, handler: () => 'ran' })

  it('names the first issue of args its schema refuses, and accepts valid ones', () => {
    const tool = fake({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'] })

    expect(validateToolArgs(tool, { path: 5 })).toMatch(/^path: /)
    expect(validateToolArgs(tool, {})).toMatch(/^path: |^\(root\): /)
    expect(validateToolArgs(tool, { path: 'a' })).toBeUndefined()
  })

  it('validateToolArgs throws on a schema it cannot compile', () => {
    expect(() => validateToolArgs(fake({ type: 'object', properties: { a: { $ref: '#/$defs/missing' } } }), { a: 1 })).toThrow()
  })
})
