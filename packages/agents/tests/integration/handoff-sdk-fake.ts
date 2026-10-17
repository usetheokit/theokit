/**
 * The SDK adapter, played by a fake model, for the handoff conversation suites (B-410).
 *
 * A test file mocks `src/bridge/sdk-adapter.js` with this module, so the REAL `AgentRunner` and
 * reflective loop run and only `createSdkAgentStream` is replaced. Per call the fake reads one
 * script, and to transfer it finds `transfer_to_agent` among the tools it was handed and awaits
 * its handler. `h` records every call and holds the scripts still to play.
 */
export interface FakeTool {
  readonly name: string
  readonly inputSchema: unknown
  readonly handler: (input: unknown) => string | Promise<string>
}

export interface FakeScript {
  /** Transfer-tool calls the fake makes, in order, before it answers. */
  readonly transfers?: readonly { agent: string; note: string }[]
  /** Thrown after the transfers, in place of an answer. */
  readonly throwAfter?: Error
  /** Aborted after the transfers, before the first event. */
  readonly abortAfter?: AbortController
  /** Awaited before anything else, so a test can hold a turn open. */
  readonly hold?: Promise<void>
  /** USD cost reported on the round's `done` event. */
  readonly cost?: number
}

export interface FakeCall {
  readonly sessionId: string
  readonly message: string
  readonly toolNames: readonly string[]
  readonly tools: readonly FakeTool[]
  readonly apiKey: unknown
  readonly overrides: Record<string, unknown>
  readonly factoryOpts: { disableTools?: boolean } | undefined
}

export const h = { calls: [] as FakeCall[], scripts: [] as FakeScript[] }

export const createSdkAgentStream =
  (
    _compiled: unknown,
    tools: readonly FakeTool[],
    apiKey: unknown,
    overrides: Record<string, unknown> = {},
  ) =>
  (
    message: string,
    sessionId: string,
    factoryOpts?: { disableTools?: boolean },
  ): AsyncIterable<{ type: string; [k: string]: unknown }> => {
    h.calls.push({
      sessionId,
      message,
      toolNames: tools.map((t) => t.name),
      tools,
      apiKey,
      overrides,
      factoryOpts,
    })
    const script = h.scripts.shift() ?? {}
    return (async function* () {
      if (script.hold) await script.hold
      for (const transfer of script.transfers ?? []) {
        const tool = tools.find((t) => t.name === 'transfer_to_agent')
        if (!tool) throw new Error('the fake model was not offered transfer_to_agent')
        await tool.handler(transfer)
      }
      if (script.throwAfter) throw script.throwAfter
      script.abortAfter?.abort()
      yield { type: 'text_delta', content: 'ok' }
      yield { type: 'done', ...(script.cost === undefined ? {} : { cost: script.cost }) }
    })()
  }
