/**
 * `createDelegateAllTool` — one tool call that starts several delegations and answers after all of
 * them settled (B-386, OpenClaw's `agents_wait`). The tests inject `DelegationPort`s, so nothing
 * here needs a credential or a network.
 */
import { describe, expect, it, vi } from 'vitest'

import { DelegationTimeoutError } from '../../src/bridge/delegation-lifecycle.js'
import type { DelegationResult } from '../../src/bridge/delegation-types.js'
import { GuardrailViolationError } from '../../src/guardrails/index.js'
import { createDelegateAllTool } from '../../src/tools/delegate-all-tool.js'

function result(response: string): DelegationResult {
  return { response, toolCalls: [], cost: 0, tokens: 0 }
}

/** A promise and the function that resolves it. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function call(
  tool: ReturnType<typeof createDelegateAllTool>,
  input: unknown,
): Promise<unknown> {
  return JSON.parse(String(await tool.handler(input as Record<string, unknown>))) as unknown
}

describe('createDelegateAllTool', () => {
  it('answers every task in input order', async () => {
    const slow = deferred()
    const tool = createDelegateAllTool({
      roster: [
        {
          name: 'a',
          target: {
            run: async (task) => {
              await slow.promise
              return result(`A:${task}`)
            },
          },
        },
        {
          name: 'b',
          target: {
            run: async (task) => {
              slow.release()
              return result(`B:${task}`)
            },
          },
        },
      ],
    })

    const answer = await call(tool, {
      tasks: [
        { agent: 'a', task: 'x' },
        { agent: 'b', task: 'y' },
      ],
    })

    expect(tool.name).toBe('delegate_all')
    expect(answer).toEqual({
      results: [
        { agent: 'a', ok: true, response: 'A:x' },
        { agent: 'b', ok: true, response: 'B:y' },
      ],
    })
  })

  it('starts every task before awaiting any', async () => {
    // Port A finishes only once port B has been called, so a sequential implementation never settles.
    const bStarted = deferred()
    const tool = createDelegateAllTool({
      roster: [
        {
          name: 'a',
          target: {
            run: async () => {
              await bStarted.promise
              return result('a done')
            },
          },
        },
        {
          name: 'b',
          target: {
            run: async () => {
              bStarted.release()
              return result('b done')
            },
          },
        },
      ],
    })

    const answer = await call(tool, {
      tasks: [
        { agent: 'a', task: 'first' },
        { agent: 'b', task: 'second' },
      ],
    })

    expect(answer).toEqual({
      results: [
        { agent: 'a', ok: true, response: 'a done' },
        { agent: 'b', ok: true, response: 'b done' },
      ],
    })
  })

  it('reports one failed task beside the others', async () => {
    const tool = createDelegateAllTool({
      roster: [
        { name: 'a', target: { run: async () => result('fine') } },
        {
          name: 'b',
          target: {
            run: async () => {
              throw new DelegationTimeoutError('b', 50)
            },
          },
        },
      ],
    })

    const answer = (await call(tool, {
      tasks: [
        { agent: 'a', task: 'x' },
        { agent: 'b', task: 'y' },
      ],
    })) as { results: { agent: string; ok: boolean; error?: string; message?: string }[] }

    expect(answer.results[0]).toEqual({ agent: 'a', ok: true, response: 'fine' })
    expect(answer.results[1]).toMatchObject({ agent: 'b', ok: false, error: 'delegation_timeout' })
    expect(answer.results[1]?.message).toContain('50 ms')
  })

  it('refuses zero and five tasks before any sub-agent starts', async () => {
    const run = vi.fn(async () => result('never'))
    const tool = createDelegateAllTool({ roster: [{ name: 'a', target: { run } }] })
    const five = Array.from({ length: 5 }, (_, i) => ({ agent: 'a', task: `t${String(i)}` }))

    await expect(tool.handler({ tasks: [] })).rejects.toThrow()
    await expect(tool.handler({ tasks: five })).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('rethrows a defect only after every task settled', async () => {
    let otherFinished = false
    const defect = new TypeError('a bug in a port')
    const tool = createDelegateAllTool({
      roster: [
        {
          name: 'broken',
          target: {
            run: async () => {
              throw defect
            },
          },
        },
        {
          name: 'slow',
          target: {
            run: async () => {
              await Promise.resolve()
              await Promise.resolve()
              otherFinished = true
              return result('done')
            },
          },
        },
      ],
    })

    const handled = tool.handler({
      tasks: [
        { agent: 'broken', task: 'x' },
        { agent: 'slow', task: 'y' },
      ],
    })

    await expect(handled).rejects.toBe(defect)
    expect(otherFinished).toBe(true)
  })

  it('withholds a guard refusal message from the model', async () => {
    const tool = createDelegateAllTool({
      roster: [
        {
          name: 'a',
          target: {
            run: async () => {
              throw new GuardrailViolationError('pii-detector', 'output', 'ssn found')
            },
          },
        },
      ],
    })

    const answer = JSON.stringify(await call(tool, { tasks: [{ agent: 'a', task: 'x' }] }))

    expect(answer).toContain('guardrail_violation')
    expect(answer).not.toContain('pii-detector')
    expect(answer).not.toContain('ssn found')
  })

  it('rethrows two defects together as one AggregateError', async () => {
    const first = new TypeError('first bug')
    const second = new RangeError('second bug')
    const failing = (error: Error) => ({
      run: async (): Promise<DelegationResult> => {
        throw error
      },
    })
    const tool = createDelegateAllTool({
      roster: [
        { name: 'a', target: failing(first) },
        { name: 'b', target: failing(second) },
      ],
    })

    const handled = tool.handler({
      tasks: [
        { agent: 'a', task: 'x' },
        { agent: 'b', task: 'y' },
      ],
    })
    const error = await Promise.resolve(handled).then(
      () => undefined,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([first, second])
  })

  it('runs two tasks for the same agent at once', async () => {
    const seen: string[] = []
    const secondStarted = deferred()
    const tool = createDelegateAllTool({
      roster: [
        {
          name: 'worker',
          target: {
            run: async (task) => {
              seen.push(task)
              if (task === 'one') await secondStarted.promise
              else secondStarted.release()
              return result(task.toUpperCase())
            },
          },
        },
      ],
    })

    const answer = await call(tool, {
      tasks: [
        { agent: 'worker', task: 'one' },
        { agent: 'worker', task: 'two' },
      ],
    })

    expect(seen).toEqual(['one', 'two'])
    expect(answer).toEqual({
      results: [
        { agent: 'worker', ok: true, response: 'ONE' },
        { agent: 'worker', ok: true, response: 'TWO' },
      ],
    })
  })

  it("hands the run's abort signal to every task's port", async () => {
    const seen: (AbortSignal | undefined)[] = []
    const port = {
      run: async (task: string, options?: { signal?: AbortSignal }) => {
        seen.push(options?.signal)
        return result(task)
      },
    }
    const tool = createDelegateAllTool({ roster: [{ name: 'worker', target: port }] })
    const controller = new AbortController()

    await tool.handler(
      {
        tasks: [
          { agent: 'worker', task: 'one' },
          { agent: 'worker', task: 'two' },
        ],
      },
      { signal: controller.signal },
    )

    expect(seen).toEqual([controller.signal, controller.signal])
  })
})
