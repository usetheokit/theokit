import type { CustomTool, Plugin } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  CodeModePermissionDeniedError,
  CodeModeResultTooLongError,
  createCodeMode,
  type CodeModeApi,
  type Sandbox,
} from '../../src/code-mode-entry.js'

/** A sandbox that calls `api[tool](args)` for code shaped `call:<tool>:<json>`, and returns `{ ran }` otherwise. */
function toySandbox(): Sandbox {
  return {
    run: async (code: string, api: CodeModeApi) => {
      const match = /^call:([a-z_]+):(.*)$/.exec(code)
      if (match === null) return { ran: code }
      const call = api[match[1] ?? '']
      if (call === undefined) throw new Error(`${match[1]} is not defined`)
      return call(JSON.parse(match[2] ?? '{}'))
    },
  }
}

function spyTool(name: string): CustomTool & { handler: ReturnType<typeof vi.fn> } {
  return {
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    handler: vi.fn(async () => `${name} ran`),
  }
}

describe('createCodeMode on @theokit/agents/code-mode', () => {
  it('refuses a config without onPermissionRequest', () => {
    expect(() =>
      createCodeMode({ tools: [spyTool('read_file')], sandbox: toySandbox() } as never),
    ).toThrow(/onPermissionRequest/)
  })

  it('refuses an empty tools list', () => {
    expect(() =>
      createCodeMode({
        tools: [],
        sandbox: toySandbox(),
        onPermissionRequest: () => ({ granted: true }),
      }),
    ).toThrow(/requires a non-empty tools\[\]/)
  })

  it('refuses a sandbox without run', () => {
    expect(() =>
      createCodeMode({
        tools: [spyTool('read_file')],
        sandbox: {} as never,
        onPermissionRequest: () => ({ granted: true }),
      }),
    ).toThrow(/sandbox/)
  })

  it('throws CodeModePermissionDeniedError when the gate denies a call', async () => {
    const writeFile = spyTool('write_file')
    const { tool } = createCodeMode({
      tools: [writeFile],
      sandbox: toySandbox(),
      onPermissionRequest: () => ({ granted: false, reason: 'not on the allow-list' }),
    })

    const run = tool.handler({ code: 'call:write_file:{"path":"x"}' })

    await expect(run).rejects.toBeInstanceOf(CodeModePermissionDeniedError)
    await expect(run).rejects.toThrow(/write_file.*not on the allow-list/)
    expect(writeFile.handler).not.toHaveBeenCalled()
  })

  it('returns the sandbox result as a JSON string', async () => {
    const { tool } = createCodeMode({
      tools: [spyTool('read_file')],
      sandbox: toySandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })

    await expect(tool.handler({ code: 'sum' })).resolves.toBe('{"ran":"sum"}')
  })

  it('calls a granted tool with the arguments the script passed', async () => {
    const readFile = spyTool('read_file')
    const { tool } = createCodeMode({
      tools: [readFile],
      sandbox: toySandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })

    await expect(tool.handler({ code: 'call:read_file:{"path":"a.txt"}' })).resolves.toBe(
      'read_file ran',
    )
    expect(readFile.handler).toHaveBeenCalledWith({ path: 'a.txt' })
  })

  it('names every allowed tool in the generated instructions', () => {
    const { tool, instructions } = createCodeMode({
      tools: [spyTool('read_file'), spyTool('list_dir')],
      sandbox: toySandbox(),
      onPermissionRequest: () => ({ granted: true }),
    })

    expect(tool.name).toBe('run_code')
    expect(instructions).toContain('api.read_file({ path: string })')
    expect(instructions).toContain('api.list_dir({ path: string })')
  })

  it("forwards the run's abort signal to the sandbox and to each tool the script calls", async () => {
    const tool = spyTool('read_file')
    let sandboxSignal: AbortSignal | undefined
    const sandbox: Sandbox = {
      run: async (_code, api, options) => {
        sandboxSignal = options?.signal
        return api.read_file?.({ path: 'a' }, options)
      },
    }
    const codeMode = createCodeMode({
      tools: [tool],
      sandbox,
      onPermissionRequest: () => ({ granted: true }),
    })
    const controller = new AbortController()

    await codeMode.tool.handler({ code: 'x' }, { signal: controller.signal })

    expect(sandboxSignal).toBe(controller.signal)
    expect(tool.handler).toHaveBeenCalledWith({ path: 'a' }, { signal: controller.signal })
  })

  describe('plugins', () => {
    const pluginWith = (
      hook: (ctx: { name: string; args: unknown; agentId: string; runId: string }) => unknown,
    ): Plugin =>
      ({
        name: 'p',
        version: '1.0.0',
        kind: 'general',
        register: (ctx: { on: (h: string, f: unknown) => unknown }) => {
          ctx.on('pre_tool_call', hook)
        },
      }) as unknown as Plugin

    it('a plugin that blocks a tool refuses the script call with the plugin message', async () => {
      const tool = spyTool('write_file')
      const seen = vi.fn()
      const { tool: run } = createCodeMode({
        tools: [tool],
        sandbox: toySandbox(),
        onPermissionRequest: () => ({ granted: true }),
        plugins: [
          pluginWith((ctx) => {
            seen(ctx)
            return { block: true, message: 'paths outside the repo are vetoed' }
          }),
        ],
        hookContext: { agentId: 'a1', runId: 'r1' },
      })
      await expect(run.handler({ code: 'call:write_file:{"path":"/etc"}' })).rejects.toThrow(
        /write_file.*paths outside the repo are vetoed/,
      )
      expect(tool.handler).not.toHaveBeenCalled()
      expect(seen).toHaveBeenCalledWith({
        name: 'write_file',
        args: { path: '/etc' },
        agentId: 'a1',
        runId: 'r1',
      })
    })

    it('onPermissionRequest still runs first and its refusal wins', async () => {
      const hook = vi.fn()
      const { tool: run } = createCodeMode({
        tools: [spyTool('write_file')],
        sandbox: toySandbox(),
        onPermissionRequest: () => ({ granted: false, reason: 'gate says no' }),
        plugins: [pluginWith(hook)],
      })
      await expect(run.handler({ code: 'call:write_file:{"path":"x"}' })).rejects.toThrow(
        /gate says no/,
      )
      expect(hook).not.toHaveBeenCalled()
    })

    it('a plugin that throws refuses the call and does not run the handler', async () => {
      const tool = spyTool('write_file')
      const { tool: run } = createCodeMode({
        tools: [tool],
        sandbox: toySandbox(),
        onPermissionRequest: () => ({ granted: true }),
        plugins: [
          pluginWith(() => {
            throw new Error('boom')
          }),
        ],
      })
      await expect(run.handler({ code: 'call:write_file:{"path":"x"}' })).rejects.toBeInstanceOf(
        CodeModePermissionDeniedError,
      )
      expect(tool.handler).not.toHaveBeenCalled()
    })

    it('a plugin that allows lets the handler run, and without plugins behaviour is unchanged', async () => {
      const withPlugin = spyTool('read_file')
      const plain = spyTool('read_file')
      const allowing = createCodeMode({
        tools: [withPlugin],
        sandbox: toySandbox(),
        onPermissionRequest: () => ({ granted: true }),
        plugins: [pluginWith(() => undefined)],
      })
      const none = createCodeMode({
        tools: [plain],
        sandbox: toySandbox(),
        onPermissionRequest: () => ({ granted: true }),
      })
      await expect(allowing.tool.handler({ code: 'call:read_file:{"path":"x"}' })).resolves.toBe(
        'read_file ran',
      )
      await expect(none.tool.handler({ code: 'call:read_file:{"path":"x"}' })).resolves.toBe(
        'read_file ran',
      )
    })
  })
})

describe('createCodeMode language, allowedTools and maxResultChars', () => {
  const base = { sandbox: toySandbox(), onPermissionRequest: () => ({ granted: true }) }

  it('names JavaScript in the tool description and the instructions', () => {
    const { tool, instructions } = createCodeMode({ ...base, tools: [spyTool('read_file')] })
    expect(tool.description).toContain('JavaScript')
    expect(instructions).toContain('JavaScript')
  })

  it('throws a typed error stating the limit and the size', async () => {
    const { tool } = createCodeMode({ ...base, tools: [spyTool('read_file')], maxResultChars: 5 })
    const error: unknown = await tool.handler({ code: 'abcdef' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CodeModeResultTooLongError)
    expect((error as Error).message).toMatch(/16 characters.*limit of 5/)
  })

  it('accepts a result exactly at the limit', async () => {
    const { tool } = createCodeMode({ ...base, tools: [spyTool('read_file')], maxResultChars: 16 })
    await expect(tool.handler({ code: 'abcdef' })).resolves.toBe('{"ran":"abcdef"}')
  })

  it('refuses a tool outside allowedTools before it runs', async () => {
    const read = spyTool('read_file')
    const write = spyTool('write_file')
    const { tool, instructions } = createCodeMode({
      ...base,
      tools: [read, write],
      allowedTools: ['read_file'],
    })
    expect(instructions).not.toContain('write_file')
    await expect(tool.handler({ code: 'call:write_file:{"path":"a"}' })).rejects.toThrow(
      /not defined/,
    )
    expect(write.handler).not.toHaveBeenCalled()
  })
})
