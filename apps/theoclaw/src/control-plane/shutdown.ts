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

/**
 * On the first SIGINT or SIGTERM: stop every runner, then close the listener, then exit 0. A
 * runner that fails to stop, or a listener that fails to close, is written and the exit code is 1;
 * the listener is closed even when a runner failed. A second signal while stopping is written and
 * ignored. Returns what removes the listeners.
 */
export function installShutdown(options: ShutdownOptions): () => void {
  let stopping = false
  const shutdown = async (): Promise<number> => {
    let code = 0
    try {
      await options.stopAll()
    } catch (error) {
      code = 1
      options.write(`theoclaw: stopping the runners failed: ${describeError(error)}`)
    }
    try {
      await options.closeServer()
    } catch (error) {
      code = 1
      options.write(`theoclaw: closing the control plane failed: ${describeError(error)}`)
    }
    return code
  }
  const listenerFor = (signal: ShutdownSignal) => (): void => {
    if (stopping) {
      options.write(`theoclaw: ${signal} ignored, already stopping`)
      return
    }
    stopping = true
    void shutdown().then(options.exit)
  }
  const onSigint = listenerFor('SIGINT')
  const onSigterm = listenerFor('SIGTERM')
  options.signals.on('SIGINT', onSigint)
  options.signals.on('SIGTERM', onSigterm)
  return () => {
    options.signals.off('SIGINT', onSigint)
    options.signals.off('SIGTERM', onSigterm)
  }
}
