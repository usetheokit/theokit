import { HostError } from '../host-error.js'

import { AppHostStartError, type AppHostStepFailure } from './errors.js'

export interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export interface AppHostOptions {
  /** Omitted: no signal handling. */
  readonly signals?: SignalSource
  /** Called after a signal-driven close. Omitted: nothing is called. */
  readonly exit?: (code: number) => void
  readonly onError?: (step: string, error: unknown) => void
  /** Whole-teardown watchdog in milliseconds, default 10_000. */
  readonly stopTimeoutMs?: number
}

export type AppHostCloseResult =
  | { ok: true }
  | {
      ok: false
      failed: readonly AppHostStepFailure[]
      timedOut: readonly string[]
    }

export interface AppHost {
  /** Register a service; start order is registration order. The getter works once the service has started. */
  service<T>(
    name: string,
    start: () => Promise<T> | T,
    stop?: (value: T) => Promise<void> | void,
  ): () => T
  /** Starts every service in order. On a failure stops the started ones in reverse and rejects with AppHostStartError. */
  start(): Promise<void>
  /** Stops started services in reverse order, once; later calls return the same promise. */
  close(): Promise<AppHostCloseResult>
}

interface Entry {
  readonly name: string
  readonly start: () => unknown
  readonly stop: ((value: never) => Promise<void> | void) | undefined
  started: boolean
  value: unknown
}

const SIGNALS = ['SIGINT', 'SIGTERM'] as const
const DEFAULT_STOP_TIMEOUT_MS = 10_000

export function createAppHost(options: AppHostOptions = {}): AppHost {
  const { signals, exit, stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS } = options
  const entries: Entry[] = []
  let startPromise: Promise<void> | undefined
  let teardownPromise: Promise<AppHostCloseResult> | undefined
  let closePromise: Promise<AppHostCloseResult> | undefined
  let signalled = false

  const report = (step: string, error: unknown): void => {
    try {
      options.onError?.(step, error)
    } catch {
      // A throwing reporter must not interrupt teardown.
    }
  }

  const onSignal = (): void => {
    if (signalled) {
      report('signal', new Error('Shutdown already in progress, signal ignored'))
      return
    }
    signalled = true
    void close().then((result) => exit?.(result.ok ? 0 : 1))
  }

  const removeListeners = (): void => {
    if (signals === undefined) return
    for (const name of SIGNALS) signals.off(name, onSignal)
  }

  /** Stops the started entries in reverse order under one watchdog. */
  const runTeardown = async (): Promise<AppHostCloseResult> => {
    const pending = entries.filter((entry) => entry.started).reverse()
    const failed: AppHostStepFailure[] = []
    let timedOut: string[] = []
    let expired = false
    let current = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async (): Promise<void> => {
      for (; current < pending.length; current++) {
        if (expired) return
        const entry = pending[current]
        entry.started = false
        try {
          await (entry.stop as ((value: unknown) => Promise<void> | void) | undefined)?.(
            entry.value,
          )
        } catch (error) {
          failed.push({ step: entry.name, error })
          report(entry.name, error)
        }
      }
    }
    const watchdog = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout')
      }, stopTimeoutMs)
    })
    const outcome = await Promise.race([run().then(() => 'done' as const), watchdog])
    clearTimeout(timer)
    if (outcome === 'timeout') {
      expired = true
      timedOut = pending.slice(current).map((entry) => entry.name)
      for (const step of timedOut)
        report(step, new Error(`Stop did not finish within ${stopTimeoutMs} ms`))
    }
    return failed.length === 0 && timedOut.length === 0
      ? { ok: true }
      : { ok: false, failed, timedOut }
  }

  /** One teardown shared by a failed start's rollback and close(). */
  const teardown = (): Promise<AppHostCloseResult> => (teardownPromise ??= runTeardown())

  const runStart = async (): Promise<void> => {
    if (signals !== undefined) for (const name of SIGNALS) signals.on(name, onSignal)
    for (const entry of entries) {
      if (closePromise !== undefined) return
      try {
        entry.value = await entry.start()
        entry.started = true
      } catch (error) {
        const result = await teardown()
        removeListeners()
        const rollbackFailures = result.ok
          ? []
          : [
              ...result.failed,
              ...result.timedOut.map((step) => ({
                step,
                error: new Error(`Stop did not finish within ${stopTimeoutMs} ms`),
              })),
            ]
        throw new AppHostStartError(entry.name, error, rollbackFailures)
      }
    }
  }

  const close = (): Promise<AppHostCloseResult> => {
    closePromise ??= (async () => {
      try {
        await startPromise?.catch(() => undefined)
        return await teardown()
      } finally {
        removeListeners()
      }
    })()
    return closePromise
  }

  return {
    service<T>(
      name: string,
      start: () => Promise<T> | T,
      stop?: (value: T) => Promise<void> | void,
    ): () => T {
      if (startPromise !== undefined || closePromise !== undefined) {
        throw new HostError(
          'host_app_invalid_state',
          `Cannot register service "${name}" after start() or close()`,
        )
      }
      const entry: Entry = {
        name,
        start,
        stop,
        started: false,
        value: undefined,
      }
      entries.push(entry)
      return () => {
        if (!entry.started) {
          throw new HostError('host_app_service_not_started', `Service "${name}" is not started`)
        }
        return entry.value as T
      }
    },
    start(): Promise<void> {
      if (closePromise !== undefined) {
        return Promise.reject(new HostError('host_app_invalid_state', 'App host is closed'))
      }
      startPromise ??= Promise.resolve().then(runStart)
      return startPromise
    },
    close,
  }
}
