import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  CodeModePermissionDeniedError,
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
})
