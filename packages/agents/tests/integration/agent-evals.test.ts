/**
 * B-413 — `runAgentEvals` runs cases against a theokit agent definition and reports a verdict per
 * case.
 *
 * Only `@theokit/sdk` is mocked, as in `step-ceiling.test.ts`: `Agent.getOrCreate` returns a
 * scripted agent, so the real `toAgentFactory`, guardrail wrapper and step-ceiling wrapper build
 * each case's handle. `@theokit/sdk/eval` is a different specifier and stays REAL, so these tests
 * also pin the SDK runner behaviour the verdict mapping relies on: a run that does not finish is a
 * row error, a throw from `send` or `wait` is a row error, a scorer's result reaches the row as
 * scored, and the runner never disposes an agent it got from a function.
 *
 * The scripted answer is the definition's system prompt, so a case expecting it passes only when
 * the definition actually reached the agent the case ran (FR-004).
 */
import 'reflect-metadata'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalPosture } from '../../src/bridge/approval-posture.js'

interface ScriptedWait {
  status?: string
  result?: string
  error?: { message: string }
}

const h = vi.hoisted(() => ({
  /** Every session id `Agent.getOrCreate` was called with, in call order. */
  ids: [] as string[],
  /** Every message a scripted agent's `send` received. */
  sends: [] as string[],
  /** How many scripted agents were disposed. */
  disposed: 0,
  /** When set, every scripted `dispose` rejects with it. */
  disposeError: undefined as Error | undefined,
  /** When set, every scripted `wait` waits for it before resolving. */
  hold: undefined as Promise<void> | undefined,
  /** When set, replaces the default answer (`{ status: 'finished', result: <system prompt> }`). */
  answer: undefined as ((prompt: string) => ScriptedWait) | undefined,
  /** Callers waiting for `ids` to reach a length; see {@link oneAtATime}. */
  waiters: [] as { length: number; resolve: () => void }[],
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string, opts: Record<string, unknown>) => {
      h.ids.push(id)
      h.waiters = h.waiters.filter((w) => (w.length <= h.ids.length ? (w.resolve(), false) : true))
      const prompt = typeof opts.systemPrompt === 'string' ? opts.systemPrompt : ''
      return {
        agentId: id,
        send: async (msg: string) => {
          h.sends.push(msg)
          return {
            wait: async (): Promise<ScriptedWait> => {
              if (h.hold !== undefined) await h.hold
              return h.answer?.(prompt) ?? { status: 'finished', result: prompt }
            },
          }
        },
        dispose: async () => {
          h.disposed += 1
          if (h.disposeError !== undefined) throw h.disposeError
        },
      }
    }),
  },
}))

const { runAgentEvals, EvalConfigError, EvalAlreadyRunningError, Scorers } =
  await import('../../src/evals-entry.js')
const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')

const NO_GATE: ApprovalPosture = {
  kind: 'auto-reject',
  reason: 'eval tests exercise verdicts, never tool approval',
}

const KIWI = AgentBuilder.create().model('m').system('KIWI').build()

/**
 * The definition as a thunk that lets one case reach `Agent.getOrCreate` at a time.
 *
 * Needed because of the test runner, not the code under test. Measured on vitest 4.1 here: of
 * several CONCURRENT `import('@theokit/sdk')` calls made from `src/`, only the first resolves the
 * mock and the others resolve the REAL module, every time and not only on the first load
 * (`[true, false, false]` for three, `[true, false]` again afterwards). The SDK runner builds up to
 * 4 cases at once, so without this the second case of a run called a real provider
 * (`openrouter API error: auth_failed`). The runner still calls the agent function concurrently;
 * only the projection of each case waits for the previous case's agent to exist.
 */
function oneAtATime(definition: typeof KIWI) {
  let calls = 0
  return async () => {
    const before = calls
    calls += 1
    if (h.ids.length < before) {
      await new Promise<void>((resolve) => h.waiters.push({ length: before, resolve }))
    }
    return definition
  }
}

/** The options every test shares; each test overrides what it is about. */
function base() {
  return {
    agent: oneAtATime(KIWI),
    apiKey: 'test-key',
    approvals: NO_GATE,
    cases: [{ input: 'What is your word?', expected: 'KIWI' }],
    scorers: [Scorers.containsExpected()],
  }
}

const network = vi.fn(() => Promise.reject(new Error('a case reached the network')))

beforeEach(() => {
  h.ids = []
  h.sends = []
  h.disposed = 0
  h.disposeError = undefined
  h.hold = undefined
  h.answer = undefined
  h.waiters = []
  // A case that missed the mock would reach a real provider and read as a plausible `error`
  // verdict. Any network call fails the test instead (see `oneAtATime` for how a miss happens).
  vi.stubGlobal('fetch', network)
})

afterEach(() => {
  const calls = network.mock.calls.length
  network.mockClear()
  vi.unstubAllGlobals()
  expect(calls, 'a case missed the @theokit/sdk mock and called the network').toBe(0)
})

describe('runAgentEvals verdicts', () => {
  it('reports pass and fail per case', async () => {
    const result = await runAgentEvals({
      ...base(),
      cases: [
        { input: 'What is your word?', expected: 'KIWI' },
        { input: 'What is your word?', expected: 'MANGO' },
      ],
    })

    expect(result.cases.map((c) => c.verdict)).toEqual(['pass', 'fail'])
    expect(result.counts).toEqual({ pass: 1, fail: 1, error: 0 })
    expect(result.cases.map((c) => c.output)).toEqual(['KIWI', 'KIWI'])
    expect(result.cases[0]?.scores.map((s) => s.name)).toEqual(['contains-expected'])
    expect(result.cases.map((c) => c.meanScore)).toEqual([1, 0])
    expect(result.threshold).toBe(0.5)
  })

  it('reports a run that does not finish as an error', async () => {
    h.answer = () => ({ status: 'error', error: { message: 'provider down' } })

    const result = await runAgentEvals(base())

    expect(result.cases[0]?.verdict).toBe('error')
    expect(result.cases[0]?.error).toBe('provider down')
    expect(result.counts).toEqual({ pass: 0, fail: 0, error: 1 })
  })

  it.each([
    ['no cases', { cases: [] }, /cases/],
    ['no scorers', { scorers: [] }, /scorers/],
    ['threshold 1.5', { threshold: 1.5 }, /threshold.*1\.5/],
    ['threshold -0.1', { threshold: -0.1 }, /threshold.*-0\.1/],
    ['threshold NaN', { threshold: Number.NaN }, /threshold.*NaN/],
    ['a case whose input is not a string', { cases: [{ input: 42 }] }, /input/],
    ['a case that is null', { cases: [null] }, /cases\[0\]\.input/],
    ['a case that is a bare string', { cases: ['hi'] }, /cases\[0\]\.input/],
  ])('refuses a configuration it cannot run: %s', async (_label, patch, message) => {
    const run = runAgentEvals({ ...base(), ...(patch as object) } as never)

    await expect(run).rejects.toBeInstanceOf(EvalConfigError)
    await expect(run).rejects.toThrow(message)
    expect(h.ids).toEqual([])
  })

  it('runs each case once', async () => {
    await runAgentEvals({
      ...base(),
      cases: [{ input: 'a' }, { input: 'b' }, { input: 'c' }],
    })

    expect(h.sends).toHaveLength(3)
    expect(h.ids).toHaveLength(3)
  })

  it('decides the verdict by the threshold', async () => {
    const sixty = [{ name: 'sixty', score: () => ({ score: 0.6 }) }]
    const half = [{ name: 'half', score: () => ({ score: 0.5 }) }]

    const atDefault = await runAgentEvals({ ...base(), scorers: sixty })
    const atSeventy = await runAgentEvals({ ...base(), scorers: sixty, threshold: 0.7 })
    const halfAtDefault = await runAgentEvals({ ...base(), scorers: half })
    const atZero = await runAgentEvals({ ...base(), scorers: half, threshold: 0 })
    const atOne = await runAgentEvals({ ...base(), scorers: half, threshold: 1 })

    expect(atDefault.cases[0]?.verdict).toBe('pass')
    expect(atSeventy.cases[0]?.verdict).toBe('fail')
    expect(halfAtDefault.cases[0]?.verdict).toBe('pass')
    expect(atZero.cases[0]?.verdict).toBe('pass')
    expect(atOne.cases[0]?.verdict).toBe('fail')
  })
})

describe('runAgentEvals reports an unmeasured case as an error, never as a fail', () => {
  it('makes the case an error when a scorer throws', async () => {
    const boom = {
      name: 'boom',
      score: () => {
        throw new Error('scorer broke')
      },
    }

    const result = await runAgentEvals({ ...base(), scorers: [Scorers.containsExpected(), boom] })

    expect(result.cases[0]?.verdict).toBe('error')
    expect(result.cases[0]?.error).toContain('scorer broke')
  })

  it('makes the case an error when a guard blocks the input', async () => {
    const agent = AgentBuilder.create()
      .model('m')
      .system('KIWI')
      .guardrail({ name: 'block-all', checkInput: () => ({ action: 'block', reason: 'nope' }) })
      .build()

    const result = await runAgentEvals({ ...base(), agent })

    expect(result.cases[0]?.verdict).toBe('error')
    expect(result.cases[0]?.error).toContain('block-all')
    expect(result.cases[0]?.error).toContain('nope')
    // The handle was built before the guard refused, so it is still released.
    expect(h.disposed).toBe(1)
  })

  it('makes the case an error when a guard blocks the output', async () => {
    const agent = AgentBuilder.create()
      .model('m')
      .system('KIWI')
      .guardrail({
        name: 'no-kiwi',
        checkOutput: (text: string) =>
          text.includes('KIWI') ? { action: 'block', reason: 'fruit leak' } : { action: 'allow' },
      })
      .build()

    const result = await runAgentEvals({ ...base(), agent })

    expect(result.cases[0]?.verdict).toBe('error')
    expect(result.cases[0]?.error).toContain('fruit leak')
    expect(result.counts).toEqual({ pass: 0, fail: 0, error: 1 })
  })

  it('makes the case an error when a scorer returns a NaN score, naming the scorer', async () => {
    const nan = { name: 'nan-scorer', score: () => ({ score: Number.NaN }) }

    const result = await runAgentEvals({ ...base(), scorers: [nan] })

    expect(result.cases[0]?.verdict).toBe('error')
    expect(result.cases[0]?.error).toContain('nan-scorer')
  })

  it('keeps a NaN score carrying its own reason an error, at threshold 0 and beside a perfect scorer', async () => {
    const nan = { name: 'nan-scorer', score: () => ({ score: Number.NaN, reason: 'mine' }) }
    const one = { name: 'one', score: () => ({ score: 1 }) }

    const atZero = await runAgentEvals({ ...base(), scorers: [nan], threshold: 0 })
    const beside = await runAgentEvals({ ...base(), scorers: [nan, one] })

    expect(atZero.cases[0]?.verdict).toBe('error')
    expect(beside.cases[0]?.verdict).toBe('error')
  })

  it('makes the case an error when a scorer returns undefined, and the run still resolves', async () => {
    const sometimes = {
      name: 'sometimes',
      score: (_output: string, expected?: unknown) =>
        (expected === 'NONE' ? undefined : { score: 1 }) as never,
    }

    const result = await runAgentEvals({
      ...base(),
      cases: [
        { input: 'a', expected: 'NONE' },
        { input: 'b', expected: 'KIWI' },
      ],
      scorers: [sometimes],
    })

    expect(result.cases.map((c) => c.verdict)).toEqual(['error', 'pass'])
    expect(result.cases[0]?.error).toContain('sometimes')
  })

  it('names a plain-function scorer scorer-0', async () => {
    const result = await runAgentEvals({ ...base(), scorers: [() => ({ score: 1 })] })

    expect(result.cases[0]?.scores.map((s) => s.name)).toEqual(['scorer-0'])
    expect(result.cases[0]?.verdict).toBe('pass')
  })

  // Unchecked, the SDK clamps 1.5 to 1 and -0.1 to 0, so a scorer on the wrong scale reads as a
  // real pass or fail.
  it.each([1.5, -0.1])(
    'makes the case an error when a scorer returns %s, outside [0, 1], naming the scorer',
    async (score) => {
      const offScale = { name: 'off-scale', score: () => ({ score }) }

      const result = await runAgentEvals({ ...base(), scorers: [offScale] })

      expect(result.cases[0]?.verdict).toBe('error')
      expect(result.cases[0]?.error).toContain('off-scale')
      expect(result.cases[0]?.error).toContain('[0, 1]')
    },
  )

  // The error signal belongs to this layer: a scorer's own reason, whatever its text, cannot turn a
  // measured score into an error.
  it('keeps a measured score an answer when its reason starts with scorer_threw:', async () => {
    const forged = {
      name: 'forged',
      score: () => ({ score: 1, reason: 'scorer_threw: not really' }),
    }

    const result = await runAgentEvals({ ...base(), scorers: [forged] })

    expect(result.cases[0]?.verdict).toBe('pass')
    expect(result.cases[0]?.error).toBeUndefined()
  })

  // `String()` throws on an object with no prototype, so describing such a value must not escape
  // the wrapper into the SDK's own catch, which this layer no longer reads.
  it.each([
    [
      'throws',
      () => {
        throw Object.create(null)
      },
    ],
    ['returns as its score', () => ({ score: Object.create(null) })],
  ])(
    'makes the case an error when a scorer %s an object with no prototype',
    async (_how, score) => {
      const opaque = { name: 'opaque', score: score as never }

      const result = await runAgentEvals({ ...base(), scorers: [opaque], threshold: 0 })

      expect(result.cases[0]?.verdict).toBe('error')
      expect(result.cases[0]?.error).toContain('opaque')
    },
  )
})

describe('runAgentEvals sessions and disposal', () => {
  it('gives each case its own session and disposes every agent after the run', async () => {
    let release!: () => void
    h.hold = new Promise<void>((resolve) => {
      release = resolve
    })

    const pending = runAgentEvals({
      ...base(),
      cases: [{ input: 'a' }, { input: 'b' }],
    })
    await vi.waitFor(() => expect(h.sends).toHaveLength(2))
    expect(h.disposed).toBe(0)
    release()
    await pending

    expect(new Set(h.ids).size).toBe(2)
    expect(h.disposed).toBe(2)
  })

  it('rejects with the error of a dispose that rejects', async () => {
    h.disposeError = new Error('dispose failed')

    await expect(runAgentEvals(base())).rejects.toThrow('dispose failed')
  })

  it('reports the run error, not a dispose, when the same-name run rejects', async () => {
    // Every dispose fails, so an implementation that let a dispose error replace the run's own
    // rejection would hand the second run `dispose failed` instead of the SDK's error.
    h.disposeError = new Error('dispose failed')

    const shared = { ...base(), name: 'overlap-dispose' }
    const [first, second] = await Promise.allSettled([
      runAgentEvals(shared),
      runAgentEvals({ ...shared }),
    ])

    expect((first as PromiseRejectedResult).reason).toEqual(new Error('dispose failed'))
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(EvalAlreadyRunningError)
    // One case per run: only the first run ever built an agent.
    expect(h.ids).toHaveLength(1)
  })

  it('uses distinct session ids when the same name runs twice in sequence', async () => {
    const twoCases = { ...base(), name: 'sequential', cases: [{ input: 'a' }, { input: 'b' }] }

    await runAgentEvals(twoCases)
    await runAgentEvals(twoCases)

    expect(h.ids).toHaveLength(4)
    expect(new Set(h.ids).size).toBe(4)
  })

  it('makes the case an error when the factory throws, runs the other case, and disposes only what was built', async () => {
    let calls = 0
    const agent = () => {
      calls += 1
      if (calls === 1) throw new Error('thunk broke')
      return KIWI
    }

    const result = await runAgentEvals({
      ...base(),
      agent,
      cases: [
        { input: 'a', expected: 'KIWI' },
        { input: 'b', expected: 'KIWI' },
      ],
    })

    expect(result.counts).toEqual({ pass: 1, fail: 0, error: 1 })
    expect(result.cases.find((c) => c.verdict === 'error')?.error).toBe('thunk broke')
    expect(h.ids).toHaveLength(1)
    expect(h.disposed).toBe(1)
  })
})

describe('runAgentEvals names', () => {
  it('lets the SDK reject a second overlapping run with the same name', async () => {
    const shared = { ...base(), name: 'overlap' }
    const [first, second] = await Promise.allSettled([
      runAgentEvals(shared),
      runAgentEvals({ ...shared }),
    ])

    expect(first.status).toBe('fulfilled')
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(EvalAlreadyRunningError)
    // The class the caller catches is the SDK's own, so the rejection is the SDK's guard firing.
    const sdkEval = await import('@theokit/sdk/eval')
    expect(EvalAlreadyRunningError).toBe(sdkEval.EvalAlreadyRunningError)
  })

  it('runs two overlapping unnamed runs side by side', async () => {
    // One thunk for both runs, so their two cases reach the SDK mock one at a time.
    const shared = base()
    const [first, second] = await Promise.allSettled([
      runAgentEvals(shared),
      runAgentEvals({ ...shared }),
    ])

    expect(first.status).toBe('fulfilled')
    expect(second.status).toBe('fulfilled')
  })
})
