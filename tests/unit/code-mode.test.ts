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
      const m = /^call:([a-z_]+):(.*)$/.exec(code)
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
    const tool = createCodeMode({
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
    const tool = createCodeMode({
      tools: [addTool, writeFileTool],
      sandbox: fakeSandbox(),
      onPermissionRequest,
    })
    await expect(tool.handler({ code: 'call:write_file:{"path":"/etc/passwd"}' })).rejects.toThrow(
      /denied|permission/i,
    )
  })

  it('rejects a filesystem escape — only declared tools are in the restricted API', async () => {
    const tool = createCodeMode({
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
    const tool = createCodeMode({
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
