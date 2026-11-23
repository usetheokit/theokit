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
 * and ignored. Resolves, once the signals are listened to, with what removes the listeners.
 *
 * The teardown is `@theokit/host`'s `createAppHost`, which stops services in reverse order of their
 * registration: the control plane is registered first so it is stopped last.
 *
 * The channel loop's `stopAll` does not reject: it writes a runner whose `stop()` rejects and goes
 * on with the others. A failing `disconnect()` is not seen at all, because `GatewayRunner.stop()`
 * in `@theokit/gateway` 0.11 discards it, so a platform that failed to disconnect still exits 0.
 */
export async function installShutdown(options: ShutdownOptions): Promise<() => void> {
  let disarmed = false
  const listeners: [ShutdownSignal, () => void][] = []
  const host = createAppHost({
    // Tracked here so that removing them is synchronous; the host only drops its own at close.
    signals: {
      on: (event, listener) => {
        listeners.push([event, listener])
        options.signals.on(event, listener)
      },
      off: (event, listener) => options.signals.off(event, listener),
    },
    exit: options.exit,
    stopTimeoutMs: STOP_TIMEOUT_MS,
    onError: (step, error) => {
      if (step === 'signal') options.write('theoclaw: signal ignored, already stopping')
      else options.write(`theoclaw: ${FAILED[step] ?? `stopping ${step} failed`}: ${describeError(error)}`)
    },
  })
  host.service('control plane', () => undefined, () => (disarmed ? undefined : options.closeServer()))
  host.service('runners', () => undefined, () => (disarmed ? undefined : options.stopAll()))
  await host.start()
  return () => {
    disarmed = true
    for (const [event, listener] of listeners.splice(0)) options.signals.off(event, listener)
  }
}
