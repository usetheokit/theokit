import { createAppHost } from '@theokit/host/app-host'

import { describeError } from './errors.js'

export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

/** Something that emits the shutdown signals: `process` in production, an EventEmitter in tests. */
export interface SignalSource {
  on(event: ShutdownSignal | 'exit', listener: () => void): unknown
  off(event: ShutdownSignal | 'exit', listener: () => void): unknown
}

export interface ShutdownOptions {
  readonly signals: SignalSource
  /** Stop every gateway runner; each drains its in-flight turns. */
  readonly stopAll: () => Promise<void>
  /** Close the listener: the webhook routes, `/health` and the `/control` socket. */
  readonly closeServer: () => Promise<void>
  readonly exit: (code: number) => void
  readonly write: (line: string) => void
}

/** The whole-teardown bound: the runners drain their in-flight turns, which takes longer than the host's 10 s default. */
const STOP_TIMEOUT_MS = 60_000

const FAILED: Readonly<Record<string, string>> = {
  runners: 'stopping the runners failed',
  'control plane': 'closing the control plane failed',
}

/**
 * On the first SIGINT or SIGTERM: stop every runner, then close the listener, then exit 0. A
 * `stopAll` that rejects, or a listener that fails to close, is written and the exit code is 1;
 * the listener is closed even when `stopAll` rejected. A second signal while stopping is written
 * and ignored. Returns what removes the listeners.
 *
 * The teardown is `@theokit/host`'s `createAppHost`, which stops services in reverse order of their
 * registration: the control plane is registered first so it is stopped last. The host attaches its
 * listeners at creation (`attachSignalsEarly`), so a signal before `start()` has run is not lost.
 *
 * The channel loop's `stopAll` does not reject: it writes a runner whose `stop()` rejects and goes
 * on with the others. A failing `disconnect()` is not seen at all, because `GatewayRunner.stop()`
 * in `@theokit/gateway` 0.11 discards it, so a platform that failed to disconnect still exits 0.
 */
export function installShutdown(options: ShutdownOptions): () => void {
  const host = createAppHost({
    signals: options.signals,
    attachSignalsEarly: true,
    exit: options.exit,
    stopTimeoutMs: STOP_TIMEOUT_MS,
    onError: (step, error, detail) => {
      if (step === 'signal') options.write(`theoclaw: ${detail?.signal ?? 'signal'} ignored, already stopping`)
      else options.write(`theoclaw: ${FAILED[step] ?? `stopping ${step} failed`}: ${describeError(error)}`)
    },
  })
  host.service('control plane', () => undefined, () => options.closeServer())
  host.service('runners', () => undefined, () => options.stopAll())
  void host.start()
  return host.detachSignals
}
