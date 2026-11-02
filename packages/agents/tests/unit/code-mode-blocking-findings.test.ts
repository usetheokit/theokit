import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import { createCodeMode, type CodeModeApi, type Sandbox } from '../../src/code-mode-entry.js'
import { createQuickJsSandbox } from '../../src/code-mode-quickjs-entry.js'
import { createListDirTool } from '../../src/tools-entry.js'

/** What a run settled to: its value, or the stable `code` of the error it rejected with. */
async function outcomeOf(run: Promise<unknown>): Promise<{ value: unknown; code?: string }> {
  return run.then(
    (value: unknown) => ({ value }),
    (error: unknown) => ({ value: undefined, code: (error as { code?: string }).code }),
  )
}

/** B-697 — the loop-code-review findings on packages/agents/src/code-mode (#81, #83, #84, #85). */
describe('code mode keeps the contracts loop-code-review found broken', () => {
  describe('sandbox options (#81)', () => {
    // #81 (quickjs-sandbox.ts:368): an option present with the value undefined replaced the default.
    it('a sandbox given timeoutMs undefined runs a trivial script with the default deadline', async () => {
      // Control (EC-4): the same script on a sandbox with no options, so a timeout below is the option.
      await expect(createQuickJsSandbox().run('return 1', {})).resolves.toBe(1)

      const sandbox = createQuickJsSandbox({ timeoutMs: undefined })

      await expect(sandbox.run('return 1', {})).resolves.toBe(1)
    })

    it('refuses a NaN timeout when the sandbox is built', () => {
      expect(() => createQuickJsSandbox({ timeoutMs: Number.NaN })).toThrow(
        expect.objectContaining({
          code: 'CODE_MODE_SANDBOX_CONFIG',
          option: 'timeoutMs',
          message: expect.stringMatching(/timeoutMs .*\(got NaN\)/) as unknown,
        }),
      )
    })

    it('negative: refuses a negative memory limit', () => {
      expect(() => createQuickJsSandbox({ memoryLimitBytes: -1 })).toThrow(
        expect.objectContaining({
          code: 'CODE_MODE_SANDBOX_CONFIG',
          option: 'memoryLimitBytes',
          message: expect.stringMatching(/memoryLimitBytes .*\(got -1\)/) as unknown,
        }),
      )
    })

    it('negative: refuses a fractional call limit', () => {
      expect(() => createQuickJsSandbox({ maxCalls: 1.5 })).toThrow(
        expect.objectContaining({
          code: 'CODE_MODE_SANDBOX_CONFIG',
          option: 'maxCalls',
          message: expect.stringMatching(/maxCalls .*\(got 1\.5\)/) as unknown,
        }),
      )
    })

    it('negative: refuses an infinite timeout', () => {
      expect(() => createQuickJsSandbox({ timeoutMs: Number.POSITIVE_INFINITY })).toThrow(
        expect.objectContaining({ code: 'CODE_MODE_SANDBOX_CONFIG', option: 'timeoutMs' }),
      )
    })

    it('negative: refuses a zero timeout', () => {
      expect(() => createQuickJsSandbox({ timeoutMs: 0 })).toThrow(
        expect.objectContaining({ code: 'CODE_MODE_SANDBOX_CONFIG', option: 'timeoutMs' }),
      )
    })

    it('edge: accepts a call limit of 0', async () => {
      const sandbox = createQuickJsSandbox({ maxCalls: 0 })

      await expect(sandbox.run('return 1', {})).resolves.toBe(1)
    })
  })

  describe('host-call lifetime (#83)', () => {
    // #83 (quickjs-sandbox.ts:344): a host call started and not awaited outlived the run.
    it('does not resolve a run while a host call it started is still pending', async () => {
      let release: () => void = () => undefined
      let callSettled = false
      let sawAbort = false
      const api: CodeModeApi = {
        // Ignores its signal, as the shipped web_fetch handler does (EC-6).
        slow: (_args, options) => {
          options?.signal?.addEventListener('abort', () => (sawAbort = true))
          return new Promise((resolve) => {
            release = () => {
              callSettled = true
              resolve('late')
            }
          })
        },
      }
      const sandbox = createQuickJsSandbox()

      const outcome = await outcomeOf(sandbox.run('api.slow({}); return 1', api))
      const settledWhenRunEnded = callSettled
      release()

      expect(sawAbort).toBe(true)
      // The run either waited for the call it started, or says it could not: never a silent success.
      expect(settledWhenRunEnded || outcome.code === 'host_call_unsettled').toBe(true)
      expect(outcome.code).toBe('host_call_unsettled')
    })

    it('negative: a failing run keeps its own error while a host call is still pending', async () => {
      const api: CodeModeApi = { slow: () => new Promise(() => undefined) }
      const sandbox = createQuickJsSandbox()

      const outcome = await outcomeOf(sandbox.run('api.slow({}); throw new Error("boom")', api))

      expect(outcome.code).toBe('script_error')
    })

    it('edge: waits for a host call that settles on abort', async () => {
      let settledOnAbort = false
      const api: CodeModeApi = {
        polite: (_args, options) =>
          new Promise((resolve) => {
            options?.signal?.addEventListener('abort', () => {
              settledOnAbort = true
              resolve('stopped')
            })
          }),
      }
      const sandbox = createQuickJsSandbox()

      const outcome = await outcomeOf(sandbox.run('api.polite({}); return 1', api))

      expect(outcome).toEqual({ value: 1 })
      expect(settledOnAbort).toBe(true)
    })
  })

  describe('the handler result (#84)', () => {
    /** A code-mode tool over a sandbox that returns `value`, whatever the script. */
    function returning(value: unknown): ReturnType<typeof createCodeMode>['tool'] {
      const sandbox: Sandbox = { run: async () => value }
      return createCodeMode({
        tools: [
          {
            name: 'noop',
            description: 'noop',
            inputSchema: { type: 'object' },
            handler: async () => 'x',
          },
        ],
        sandbox,
        onPermissionRequest: () => ({ granted: true }),
      }).tool
    }

    // #84 (code-mode.ts:192): the handler typed Promise<string> resolved undefined.
    it('the code-mode handler resolves a string when the sandbox returns undefined', async () => {
      const result: unknown = await returning(undefined).handler({ code: 'return' })

      expect(result).toBe('null')
    })

    it('edge: resolves null for a function result', async () => {
      const result: unknown = await returning(() => 1).handler({ code: 'return' })

      expect(result).toBe('null')
    })

    it('edge: resolves null for an object whose toJSON answers undefined', async () => {
      const result: unknown = await returning({ toJSON: () => undefined }).handler({
        code: 'return',
      })

      expect(result).toBe('null')
    })
  })

  describe('script arguments (#85)', () => {
    /** A plain `CustomTool` (no `Tool.create` validation) whose handler records its calls. */
    function plainRead(): CustomTool & { handler: ReturnType<typeof vi.fn> } {
      return {
        name: 'read',
        description: 'read a path',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        handler: vi.fn(async () => 'ran'),
      }
    }

    /** Run one `api.<name>(args)` call through code mode; the error it rejected with, if any. */
    async function callWith(tool: CustomTool, args: unknown): Promise<unknown> {
      const sandbox: Sandbox = { run: async (_code, api) => api[tool.name]?.(args) }
      const { tool: codeMode } = createCodeMode({
        tools: [tool],
        sandbox,
        onPermissionRequest: () => ({ granted: true }),
      })
      return codeMode.handler({ code: 'x' }).then(
        () => undefined,
        (error: unknown) => error,
      )
    }

    // #85 (code-mode.ts:168): script arguments reached a plain CustomTool without its schema check.
    it('does not call a plain CustomTool handler with arguments its inputSchema refuses', async () => {
      const read = plainRead()

      const error = await callWith(read, {})

      expect(read.handler).not.toHaveBeenCalled()
      expect(error).toMatchObject({
        code: 'CODE_MODE_INVALID_ARGUMENTS',
        tool: 'read',
        property: 'path',
        message: expect.stringMatching(/'read'.*path.*required/) as unknown,
      })
    })

    it('negative: refuses a property of the wrong type', async () => {
      const read = plainRead()

      const error = await callWith(read, { path: 3 })

      expect(read.handler).not.toHaveBeenCalled()
      expect(error).toMatchObject({
        code: 'CODE_MODE_INVALID_ARGUMENTS',
        property: 'path',
        message: expect.stringMatching(/expected string/) as unknown,
      })
    })

    it('edge: calls the handler with arguments the schema accepts', async () => {
      const read = plainRead()

      const error = await callWith(read, { path: 'a.txt' })

      expect(error).toBeUndefined()
      expect(read.handler).toHaveBeenCalledWith({ path: 'a.txt' })
    })

    it('negative: refuses a null argument', async () => {
      const read = plainRead()

      const error = await callWith(read, null)

      expect(read.handler).not.toHaveBeenCalled()
      expect(error).toMatchObject({ code: 'CODE_MODE_INVALID_ARGUMENTS', property: undefined })
    })

    it('edge: accepts a call to the real list_dir schema', async () => {
      const listDir = createListDirTool({ projectRoot: '.' })
      const handler = vi.fn(async () => '[]')

      const error = await callWith({ ...listDir, handler }, { path: '.' })

      expect(error).toBeUndefined()
      expect(handler).toHaveBeenCalledOnce()
    })
  })
})
