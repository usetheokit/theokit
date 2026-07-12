import { describe, expect, it, vi } from 'vitest'

import {
  createCodeMode,
  type Sandbox,
  type CodeModeApi,
} from '../../packages/theo/src/server/agent/code-mode.js'
import { defineAgentTool } from '../../packages/theo/src/server/define/define-agent-tool.js'
import { z } from 'zod'

/**
 * M29 (ADR-0041) — createCodeMode: the agent composes tools in code run inside an ISOLATION
 * boundary. The boundary (`sandbox`) is INJECTED — TheoKit does NOT hand-roll a sandbox (Top-risk 1;
 * the app supplies a vetted one: isolated-vm / QuickJS-WASM / a worker). TheoKit owns the restricted
 * API assembly + the MANDATORY permission gate (no default-allow for any tool — mirrors M17).
 */

/** A fake sandbox that calls one api function named in `code` as `call:<tool>` with JSON args. */
function fakeSandbox(): Sandbox {
  return {
    run: async (code: string, api: CodeModeApi) => {
      // Toy protocol: "call:<tool>:<jsonArgs>" — enough to exercise the gate without a real VM.
      const m = /^call:([a-zA-Z_]+):(.*)$/.exec(code)
      if (!m) return { ran: code }
      const fn = api[m[1]]
      if (!fn) throw new Error(`ReferenceError: ${m[1]} is not defined`) // not in the restricted API
      return fn(JSON.parse(m[2]))
    },
  }
}

const addTool = defineAgentTool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  handler: ({ a, b }) => String(a + b),
})

const writeFileTool = defineAgentTool({
  name: 'write_file',
  description: 'Write a file (dangerous)',
  inputSchema: z.object({ path: z.string() }),
  handler: ({ path }) => `wrote ${path}`,
})

describe('M29 — createCodeMode', () => {
  it('fails fast without onPermissionRequest (security by default — no default-allow)', () => {
    expect(() => createCodeMode({ tools: [addTool], sandbox: fakeSandbox() } as never)).toThrow(
      /onPermissionRequest/,
    )
  })

  it('runs safe code that calls a permitted tool', async () => {
    const onPermissionRequest = vi.fn(() => ({ granted: true }))
    const { tool } = createCodeMode({
      tools: [addTool],
      sandbox: fakeSandbox(),
      onPermissionRequest,
    })
    const out = await tool.handler({ code: 'call:add:{"a":2,"b":3}' })
    expect(onPermissionRequest).toHaveBeenCalledWith({ tool: 'add', args: { a: 2, b: 3 } })
    expect(out).toContain('5')
  })

  it('blocks a tool call the permission gate denies', async () => {
    const onPermissionRequest = vi.fn((req: { tool: string }) => ({
      granted: req.tool !== 'write_file',
    }))
    const { tool } = createCodeMode({
      tools: [addTool, writeFileTool],
      sandbox: fakeSandbox(),
      onPermissionRequest,
    })
    await expect(tool.handler({ code: 'call:write_file:{"path":"/etc/passwd"}' })).rejects.toThrow(
      /denied|permission/i,
    )
  })

  it('rejects a filesystem escape — only declared tools are in the restricted API', async () => {
    const { tool } = createCodeMode({
      tools: [addTool],
      sandbox: fakeSandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })
    // `fs` is not a declared tool → not in the API → the sandbox throws a ReferenceError.
    await expect(tool.handler({ code: 'call:fs:{}' })).rejects.toThrow(
      /not defined|ReferenceError/i,
    )
  })

  it('honors a custom name + description', () => {
    const { tool } = createCodeMode({
      tools: [addTool],
      sandbox: fakeSandbox(),
      onPermissionRequest: () => ({ granted: true }),
      name: 'run_code',
      description: 'Execute composed code',
    })
    expect(tool.name).toBe('run_code')
    expect(tool.description).toBe('Execute composed code')
  })
})

describe('M40 — createCodeMode generated instructions (ADR-0049)', () => {
  const getTopProducts = defineAgentTool({
    name: 'getTopProducts',
    description: 'Get top selling products',
    inputSchema: z.object({ limit: z.number() }),
    handler: () => '[]',
  })
  const getSupplier = defineAgentTool({
    name: 'getSupplier',
    description: 'Get a supplier by id',
    inputSchema: z.object({ id: z.string(), region: z.string().optional() }),
    handler: () => '{}',
  })
  const make = (tools = [getTopProducts]) =>
    createCodeMode({
      tools,
      sandbox: fakeSandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })

  it('returns { tool, instructions } — the tool is the M29 CustomTool (behavior unchanged)', async () => {
    const { tool, instructions } = make()
    expect(typeof instructions).toBe('string')
    expect(tool.name).toBe('run_code')
    // Behavior-identical: the tool still runs code through the gate + sandbox.
    const out = await tool.handler({ code: 'call:getTopProducts:{"limit":5}' })
    expect(out).toBe('[]')
  })

  it('lists each declared tool as `await api.<name>(<input>)` with its description + input shape', () => {
    const { instructions } = make([getTopProducts, getSupplier])
    expect(instructions).toContain('await api.getTopProducts({ limit: number })')
    expect(instructions).toContain('Get top selling products')
    // Optional props marked with `?`.
    expect(instructions).toContain('await api.getSupplier({ id: string, region?: string })')
  })

  it('carries the fixed code contract (sandbox, one result, Promise.all)', () => {
    const { instructions } = make()
    expect(instructions).toMatch(/sandbox/i)
    expect(instructions).toMatch(/return .*(one|single|structured) .*result/i)
    expect(instructions).toMatch(/Promise\.all/)
  })

  it('fails fast without a sandbox (security by default — a vetted boundary is required)', () => {
    expect(() =>
      createCodeMode({
        tools: [getTopProducts],
        onPermissionRequest: () => ({ granted: true }),
      } as never),
    ).toThrow(/sandbox/)
  })

  it('fails fast on an empty tools[] (the restricted API would be empty)', () => {
    expect(() =>
      createCodeMode({
        tools: [],
        sandbox: fakeSandbox(),
        onPermissionRequest: () => ({ granted: true }),
      }),
    ).toThrow(/non-empty tools/)
  })

  it('renders a no-argument tool as `api.<name>({})` (no double-space)', () => {
    const ping = defineAgentTool({
      name: 'ping',
      description: 'Health check',
      inputSchema: z.object({}),
      handler: () => 'ok',
    })
    const { instructions } = make([ping])
    expect(instructions).toContain('await api.ping({})')
    expect(instructions).not.toContain('{  }')
  })

  it('instructions reference the CONFIGURED tool name when overridden', () => {
    const { instructions } = createCodeMode({
      tools: [getTopProducts],
      sandbox: fakeSandbox(),
      onPermissionRequest: () => ({ granted: true }),
      name: 'run_analysis',
    })
    expect(instructions).toContain('`run_analysis`')
    expect(instructions).not.toContain('`run_code`')
  })

  it('scoping — distinct instances list ONLY their own allow-list (least privilege)', () => {
    const sales = createCodeMode({
      tools: [getTopProducts],
      sandbox: fakeSandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })
    const inventory = createCodeMode({
      tools: [getSupplier],
      sandbox: fakeSandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })
    expect(sales.instructions).toContain('api.getTopProducts')
    expect(sales.instructions).not.toContain('api.getSupplier')
    expect(inventory.instructions).toContain('api.getSupplier')
    expect(inventory.instructions).not.toContain('api.getTopProducts')
  })
})
