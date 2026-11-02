import { describe, expect, it } from 'vitest'

import { type CodeModeApi } from '../../src/code-mode-entry.js'
import { createQuickJsSandbox } from '../../src/code-mode-quickjs-entry.js'

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
})
