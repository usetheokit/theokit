import { describeError } from './errors.js'

export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

/** Something that emits the shutdown signals: `process` in production, an EventEmitter in tests. */
export interface SignalSource {
  on(event: ShutdownSignal, listener: () => void): unknown
}

export interface ShutdownOptions {
  readonly signals: SignalSource
  readonly close: () => Promise<void>
  readonly exit: (code: number) => void
  readonly stderr: (line: string) => void
}

/**
 * On the first SIGINT or SIGTERM: close the listener and exit 0, or write why the close failed and
 * exit 1. A second signal while closing is written and ignored.
 */
export function installShutdown(options: ShutdownOptions): void {
  let stopping = false
  const listenerFor = (signal: ShutdownSignal) => (): void => {
    if (stopping) {
      options.stderr(`theoclaw: ${signal} ignored, already stopping`)
      return
    }
    stopping = true
    options.close().then(
      () => options.exit(0),
      (error: unknown) => {
        options.stderr(`theoclaw: closing the control plane failed: ${describeError(error)}`)
        options.exit(1)
      },
    )
  }
  options.signals.on('SIGINT', listenerFor('SIGINT'))
  options.signals.on('SIGTERM', listenerFor('SIGTERM'))
}
