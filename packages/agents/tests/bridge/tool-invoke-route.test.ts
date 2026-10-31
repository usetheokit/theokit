import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  createToolInvokeRoute,
  type ToolInvokeRouteOptions,
} from '../../src/bridge/tool-invoke-route.js'

const URL_ = 'http://127.0.0.1:8080/tools/invoke'
const ONE_MIB = 1_048_576

type Handler = CustomTool['handler']

function echoTool(handler: Handler = vi.fn<Handler>((input) => String(input.text))): CustomTool {
  return {
    name: 'echo',
    description: 'echoes text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    handler,
  }
}

function invoke(body: unknown, init: RequestInit = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

async function answered(
  options: ToolInvokeRouteOptions,
  request: Request,
): Promise<{
  status: number
  body: { ok?: unknown; result?: unknown; error?: { type?: unknown; message?: unknown } }
}> {
  const response = await createToolInvokeRoute(options)(request)
  if (response === undefined) throw new Error('the route answered nothing')
  return { status: response.status, body: (await response.json()) as never }
}

describe('createToolInvokeRoute', () => {
  it('runs the named tool and answers its result', async () => {
    const { status, body } = await answered(
      { tools: [echoTool()] },
      invoke({ tool: 'echo', args: { text: 'x' } }),
    )

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, result: 'x' })
  })

  it.each([
    ['no tool name', { args: {} }],
    ['args not an object', { tool: 'echo', args: [1] }],
    ['not JSON', 'nope'],
  ])('answers 400 for a body without a tool name (%s)', async (_name, payload) => {
    const handler = vi.fn<Handler>(() => 'ran')

    const { status, body } = await answered({ tools: [echoTool(handler)] }, invoke(payload))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error?.type).toBe('invalid_request')
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 404 for a tool it does not expose', async () => {
    const { status, body } = await answered(
      { tools: [echoTool()] },
      invoke({ tool: 'shell_exec', args: {} }),
    )

    expect(status).toBe(404)
    expect(body.error?.type).toBe('not_found')
  })

  it('answers 403 and never runs the tool when the veto refuses', async () => {
    const handler = vi.fn<Handler>(() => 'ran')
    const veto = vi.fn(() => 'theoclaw: no')

    const { status, body } = await answered(
      { tools: [echoTool(handler)], veto },
      invoke({ tool: 'echo', args: { text: 'x' } }),
    )

    expect(status).toBe(403)
    expect(body.error).toEqual({ type: 'refused', message: 'theoclaw: no' })
    expect(veto).toHaveBeenCalledWith('echo', { text: 'x' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 403 and never runs the tool when the veto throws', async () => {
    const handler = vi.fn<Handler>(() => 'ran')
    const veto = (): string | undefined => {
      throw new Error('paths must be an array')
    }

    const { status, body } = await answered(
      { tools: [echoTool(handler)], veto },
      invoke({ tool: 'echo', args: {} }),
    )

    expect(status).toBe(403)
    expect(body.error).toEqual({
      type: 'refused',
      message: 'the call was refused: paths must be an array',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes the request signal to the tool handler', async () => {
    const handler = vi.fn<Handler>(() => 'ran')
    const request = invoke({ tool: 'echo', args: {} })

    await answered({ tools: [echoTool(handler)] }, request)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[1]?.signal).toBe(request.signal)
  })

  it('answers 500 tool_error when the tool throws', async () => {
    const handler = vi.fn<Handler>(() => {
      throw new Error('disk full')
    })

    const { status, body } = await answered(
      { tools: [echoTool(handler)] },
      invoke({ tool: 'echo', args: {} }),
    )

    expect(status).toBe(500)
    expect(body).toEqual({ ok: false, error: { type: 'tool_error', message: 'disk full' } })
  })

  it('answers 500 tool_error when the tool throws a string', async () => {
    const handler = vi.fn<Handler>(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a tool may throw a non-Error (EC-4)
      throw 'boom'
    })

    const { status, body } = await answered(
      { tools: [echoTool(handler)] },
      invoke({ tool: 'echo', args: {} }),
    )

    expect(status).toBe(500)
    expect(body.error?.message).toBe('boom')
  })

  it('answers 413 for a body over 1 MiB', async () => {
    const handler = vi.fn<Handler>(() => 'ran')

    const response = await createToolInvokeRoute({ tools: [echoTool(handler)] })(
      invoke('x'.repeat(ONE_MIB + 1)),
    )

    expect(response?.status).toBe(413)
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 405 for GET /tools/invoke', async () => {
    const handler = vi.fn<Handler>(() => 'ran')

    const response = await createToolInvokeRoute({ tools: [echoTool(handler)] })(new Request(URL_))

    expect(response?.status).toBe(405)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns undefined for a path it does not own', async () => {
    const route = createToolInvokeRoute({ tools: [echoTool()] })

    expect(await route(new Request('http://127.0.0.1:8080/tools'))).toBeUndefined()
    expect(await route(new Request('http://127.0.0.1:8080/v1/models'))).toBeUndefined()
  })

  it('answers 400 invalid_args and never runs the tool when validate refuses', async () => {
    const handler = vi.fn<Handler>(() => 'ran')
    const validate = vi.fn(() => 'text: expected string')

    const { status, body } = await answered(
      { tools: [echoTool(handler)], validate },
      invoke({ tool: 'echo', args: { text: 1 } }),
    )

    expect(status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: { type: 'invalid_args', message: 'text: expected string' },
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs the veto before validate', async () => {
    const validate = vi.fn(() => undefined)

    const { status } = await answered(
      { tools: [echoTool()], veto: () => 'refused', validate },
      invoke({ tool: 'echo', args: { text: 'x' } }),
    )

    expect(status).toBe(403)
    expect(validate).not.toHaveBeenCalled()
  })

  it('runs the tool on unvalidated args when no validate is given', async () => {
    const handler = vi.fn<Handler>(() => 'ran')

    await answered({ tools: [echoTool(handler)] }, invoke({ tool: 'echo', args: { text: 123 } }))

    expect(handler.mock.calls[0]?.[0]).toEqual({ text: 123 })
  })

  it('answers 500 tool_error when validate throws', async () => {
    const handler = vi.fn<Handler>(() => 'ran')
    const validate = (): string | undefined => {
      throw new Error('cannot compile the schema')
    }

    const { status, body } = await answered(
      { tools: [echoTool(handler)], validate },
      invoke({ tool: 'echo', args: {} }),
    )

    expect(status).toBe(500)
    expect(body.error).toEqual({ type: 'tool_error', message: 'cannot compile the schema' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers content blocks a tool returns as its result', async () => {
    const blocks = [{ type: 'text' as const, text: 'a' }]

    const { body } = await answered(
      { tools: [echoTool(() => blocks)] },
      invoke({ tool: 'echo', args: {} }),
    )

    expect(body).toEqual({ ok: true, result: blocks })
  })

  it('treats missing args as an empty object', async () => {
    const handler = vi.fn<Handler>(() => 'ran')

    await answered({ tools: [echoTool(handler)] }, invoke({ tool: 'echo' }))

    expect(handler.mock.calls[0]?.[0]).toEqual({})
  })
})
