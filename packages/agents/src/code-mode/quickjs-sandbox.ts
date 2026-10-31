/**
 * B-386 — the vetted `Sandbox` for `createCodeMode`: QuickJS compiled to WebAssembly, the sync
 * release build (plan D2). A script runs in its own runtime and context, which see the standard
 * ECMAScript globals and `api` and nothing of the host: no `require`, `process`, `fetch` or timers.
 * Only JSON crosses the boundary, in both directions.
 *
 * Four bounds, each a typed failure (`CodeModeSandboxError.code`):
 *  - time: one deadline per run, checked by the interrupt handler while bytecode runs AND raced
 *    against every awaited host call, since no bytecode runs while the host is awaited (EC-1);
 *  - memory: the runtime's own allocation limit;
 *  - calls: the call past `maxCalls` is refused before the host is called, and the run ends with
 *    `call_limit` even when the script catches that refusal;
 *  - result: a value `JSON.stringify` cannot carry is refused rather than returned half-read.
 *
 * Every handle and deferred a run creates is disposed before its context and runtime, on every
 * path, so a failure surfaces its own code and never the runtime's leak assertion (EC-2).
 *
 * The VM packages are optional peers of `@theokit/agents`, imported by this module alone, so only
 * an app that imports `@theokit/agents/code-mode-quickjs` installs or loads the WASM.
 */
import variant from '@jitl/quickjs-wasmfile-release-sync'
import { TheokitAgentError } from '@theokit/sdk/errors'
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'

import type { CodeModeApi, Sandbox } from './code-mode.js'

export interface QuickJsSandboxOptions {
  /** The whole run's bound, host calls included. Default 10000. */
  readonly timeoutMs?: number
  /** The runtime's allocation limit. Default 33554432 (32 MiB). */
  readonly memoryLimitBytes?: number
  /** How many `api` calls one run may make. Default 16. */
  readonly maxCalls?: number
}

export type CodeModeSandboxErrorCode =
  | 'script_error'
  | 'timeout'
  | 'memory_limit'
  | 'call_limit'
  | 'unserialisable_result'

/** A script run that did not produce a JSON value, with the reason as a stable code. */
export class CodeModeSandboxError extends TheokitAgentError {
  override readonly name = 'CodeModeSandboxError'

  constructor(
    readonly code: CodeModeSandboxErrorCode,
    message: string,
  ) {
    // A script that failed fails the same way when it is run again unchanged.
    super(`code-mode sandbox: ${code}: ${message}`, { code, isRetryable: false })
  }
}

const DEFAULTS = { timeoutMs: 10_000, memoryLimitBytes: 33_554_432, maxCalls: 16 } as const

/** Anything a run must dispose: a handle, a deferred promise. */
interface Owned {
  readonly alive: boolean
  dispose(): void
}

/** What one run knows about why it stopped, set where the VM cannot say it. */
interface RunState {
  interrupted: boolean
  callLimitReached: boolean
  calls: number
}

function messageOf(dumped: unknown): string {
  if (typeof dumped === 'object' && dumped !== null && 'message' in dumped) {
    return String(dumped.message)
  }
  return String(dumped)
}

/**
 * The typed failure for what the VM threw, or for a host-side QuickJS failure. The run's own state
 * is read first: a deadline or a call limit reached while serialising the result is still a
 * deadline or a call limit, whatever the VM's message says.
 */
function classify(thrown: unknown, state: RunState): CodeModeSandboxError {
  if (state.callLimitReached) {
    return new CodeModeSandboxError(
      'call_limit',
      'the script made more api calls than its limit allows',
    )
  }
  if (state.interrupted)
    return new CodeModeSandboxError('timeout', 'the script ran past its deadline')
  const message = messageOf(thrown)
  if (/out of memory/i.test(message)) {
    return new CodeModeSandboxError('memory_limit', 'the script allocated past its memory limit')
  }
  if (thrown instanceof CodeModeSandboxError) return thrown
  return new CodeModeSandboxError('script_error', message)
}

/** One run: a fresh runtime and context, the owned handles, the host calls in flight. */
class QuickJsRun {
  private readonly owned: Owned[] = []
  private readonly pending = new Set<Promise<void>>()
  private readonly state: RunState = { interrupted: false, callLimitReached: false, calls: 0 }
  private readonly runtime: QuickJSRuntime
  private readonly context: QuickJSContext
  private readonly jsonParse: QuickJSHandle
  private readonly jsonStringify: QuickJSHandle
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Set when disposal itself failed: the WASM module may have aborted, and must not be reused. */
  moduleBroken = false

  constructor(
    module: QuickJSWASMModule,
    private readonly limits: Required<QuickJsSandboxOptions>,
    private readonly deadline: number,
  ) {
    this.runtime = module.newRuntime()
    this.runtime.setMemoryLimit(limits.memoryLimitBytes)
    this.runtime.setInterruptHandler(() => {
      if (Date.now() <= this.deadline) return false
      this.state.interrupted = true
      return true
    })
    this.context = this.runtime.newContext()
    const json = this.own(this.context.getProp(this.context.global, 'JSON'))
    this.jsonParse = this.own(this.context.getProp(json, 'parse'))
    this.jsonStringify = this.own(this.context.getProp(json, 'stringify'))
  }

  async execute(code: string, api: CodeModeApi): Promise<unknown> {
    let failure: unknown
    try {
      this.installApi(api)
      const promise = this.own(
        this.context.unwrapResult(this.context.evalCode(`(async () => {\n${code}\n})()`)),
      )
      return await this.settle(promise)
    } catch (error) {
      failure = classify(error, this.state)
      throw failure
    } finally {
      this.dispose(failure)
    }
  }

  private own<T extends Owned>(item: T): T {
    this.owned.push(item)
    return item
  }

  private installApi(api: CodeModeApi): void {
    const apiObject = this.own(this.context.newObject())
    for (const [name, call] of Object.entries(api)) {
      const fn = this.own(
        this.context.newFunction(name, (argument) => this.callHost(call, argument)),
      )
      this.context.setProp(apiObject, name, fn)
    }
    this.context.setProp(this.context.global, 'api', apiObject)
  }

  /** Answer one `api.<name>(input)` with a VM promise the host call settles. */
  private callHost(
    call: (args: unknown) => Promise<unknown>,
    argument: QuickJSHandle | undefined,
  ): QuickJSHandle {
    this.state.calls += 1
    if (this.state.calls > this.limits.maxCalls) {
      this.state.callLimitReached = true
      throw new Error(`call_limit: more than ${this.limits.maxCalls} api calls`)
    }
    const input: unknown =
      argument === undefined || this.context.typeof(argument) === 'undefined'
        ? {}
        : this.context.dump(argument)
    const deferred = this.own(this.context.newPromise())
    const settled = Promise.resolve()
      .then(() => call(input))
      .then(
        (value) => {
          this.settleDeferred(deferred, () => this.toHandle(value), 'resolve')
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          this.settleDeferred(deferred, () => this.context.newError(message), 'reject')
        },
      )
      .finally(() => {
        this.pending.delete(settled)
      })
    this.pending.add(settled)
    return deferred.handle
  }

  private settleDeferred(
    deferred: ReturnType<QuickJSContext['newPromise']>,
    make: () => QuickJSHandle,
    how: 'resolve' | 'reject',
  ): void {
    // The run may have ended (a timeout) while the host call was in flight; its VM is gone.
    if (!deferred.alive || !this.context.alive) return
    const handle = make()
    try {
      deferred[how](handle)
    } finally {
      handle.dispose()
    }
  }

  /**
   * A host value as a VM value: JSON through the VM's own `JSON.parse`, a non-JSON string as itself
   * (EC-8). A string that IS JSON arrives parsed, so a tool answering `"42"` hands the script 42.
   */
  private toHandle(value: unknown): QuickJSHandle {
    if (value === undefined) return this.context.undefined
    let json: string
    if (typeof value === 'string') {
      try {
        JSON.parse(value)
        json = value
      } catch {
        // Not JSON: the script receives the text itself (EC-8).
        return this.context.newString(value)
      }
    } else {
      json = JSON.stringify(value)
    }
    const text = this.context.newString(json)
    try {
      return this.context.unwrapResult(
        this.context.callFunction(this.jsonParse, this.context.undefined, text),
      )
    } finally {
      text.dispose()
    }
  }

  /** Drive the VM's jobs until the script's promise settles, waiting on host calls between passes. */
  private async settle(promise: QuickJSHandle): Promise<unknown> {
    const deadlineReached = new Promise<void>((resolve) => {
      this.timer = setTimeout(resolve, Math.max(0, this.deadline - Date.now()))
    })
    for (;;) {
      const jobs = this.runtime.executePendingJobs()
      if (jobs.error) {
        const thrown: unknown = this.context.dump(jobs.error)
        jobs.error.dispose()
        throw thrown
      }
      if (this.state.callLimitReached) throw classify(undefined, this.state)
      const state = this.context.getPromiseState(promise)
      if (state.type === 'fulfilled') {
        try {
          return this.toJson(state.value)
        } finally {
          state.value.dispose()
        }
      }
      if (state.type === 'rejected') {
        const thrown: unknown = this.context.dump(state.error)
        state.error.dispose()
        throw thrown
      }
      if (this.pending.size === 0) {
        throw new CodeModeSandboxError(
          'script_error',
          'the script awaits a promise that nothing can settle',
        )
      }
      await Promise.race([...this.pending, deadlineReached])
      if (Date.now() > this.deadline) {
        this.state.interrupted = true
        throw classify(undefined, this.state)
      }
    }
  }

  /** The script's value as JSON, read through the VM's own `JSON.stringify`; `undefined` is `null` (EC-5). */
  private toJson(value: QuickJSHandle): unknown {
    const kind = this.context.typeof(value)
    if (kind === 'undefined') return null
    if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
      throw new CodeModeSandboxError('unserialisable_result', `the script returned a ${kind}`)
    }
    const result = this.context.callFunction(this.jsonStringify, this.context.undefined, value)
    if (result.error) {
      const reason = messageOf(this.context.dump(result.error))
      result.error.dispose()
      throw new CodeModeSandboxError('unserialisable_result', reason)
    }
    const text = result.value
    try {
      if (this.context.typeof(text) !== 'string') {
        throw new CodeModeSandboxError(
          'unserialisable_result',
          'the script returned a value JSON cannot carry',
        )
      }
      return JSON.parse(this.context.getString(text)) as unknown
    } finally {
      text.dispose()
    }
  }

  /** Dispose everything this run made, newest first, then the context and the runtime. */
  private dispose(failure: unknown): void {
    clearTimeout(this.timer)
    try {
      for (const item of [...this.owned].reverse()) {
        if (item.alive) item.dispose()
      }
      this.context.dispose()
      this.runtime.dispose()
    } catch (error) {
      this.moduleBroken = true
      // On a failed run the typed failure already propagating is the one the caller must see (EC-2);
      // a disposal that fails after a successful run is a defect, and is not hidden.
      if (failure === undefined) throw error
    }
  }
}

/**
 * A `Sandbox` that runs each script in a fresh QuickJS-WASM runtime, bounded in time, memory and
 * calls. The WASM module is compiled once per sandbox, on its first run.
 */
export function createQuickJsSandbox(options: QuickJsSandboxOptions = {}): Sandbox {
  const limits: Required<QuickJsSandboxOptions> = { ...DEFAULTS, ...options }
  let module: Promise<QuickJSWASMModule> | undefined
  return {
    run: async (code, api) => {
      const deadline = Date.now() + limits.timeoutMs
      module ??= newQuickJSWASMModuleFromVariant(variant)
      const run = new QuickJsRun(await module, limits, deadline)
      try {
        return await run.execute(code, api)
      } finally {
        // A runtime whose disposal failed can abort the whole emscripten module; the next run
        // compiles a fresh one rather than failing on a module that is gone.
        if (run.moduleBroken) module = undefined
      }
    },
  }
}
