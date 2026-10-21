import { createServer } from 'node:http'

import { nodeIncomingToRequest, writeResponseToNode } from '@theokit/http/runtime/node'
import type { RuntimeAdapter, ServerHandle } from '@theokit/http/runtime/node'

import { TheoClawConfigError } from './channels/output-mask.js'

/** `THEOCLAW_PORT`: digits only, 0 to 65535. The message names the variable and never the value. */
export function parsePort(value: string | undefined): number {
  const port = value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port > 65_535) {
    throw new TheoClawConfigError('THEOCLAW_PORT must be an integer from 0 to 65535')
  }
  return port
}

export interface ServerOptions {
  readonly handler: (request: Request) => Promise<Response>
  readonly port: number
  /** A runtime to serve through instead of Node's HTTP server; tests pass a fake. */
  readonly runtime?: RuntimeAdapter
  /** Where a request the handler failed is written. Default: process.stderr. */
  readonly write?: (line: string) => void
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Node's HTTP server over the `@theokit/http` request and response conversions. It is built here
 * rather than taken from `createNodeAdapter()` because that adapter's handle gives a failing
 * `listen` (an address in use) no way back: the error surfaces as an uncaught exception and the
 * start never settles.
 */
function listenOnNode(options: ServerOptions): Promise<ServerHandle> {
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`))
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
        await writeResponseToNode(await options.handler(nodeIncomingToRequest(incoming)), outgoing)
      } catch (error) {
        write(`server: request failed: ${describeError(error)}`)
        if (!outgoing.headersSent) outgoing.writeHead(500)
        outgoing.end()
      }
    })()
  })
  const handle: ServerHandle = {
    listen: (port, callback) => void server.listen(port, callback),
    // ServerHandle's callback takes no error: closing a server that is not running is the one
    // failure close() reports, and the caller has nothing left to stop in that case.
    close: (callback) => void server.close(() => callback?.()),
    address: () => {
      const address = server.address()
      return typeof address === 'object' && address !== null ? { port: address.port } : null
    },
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, () => {
      server.off('error', reject)
      resolve(handle)
    })
  })
}

/** Serve `handler` on `port` (0 picks a free one); resolves once the server listens. */
export function startServer(options: ServerOptions): Promise<ServerHandle> {
  if (options.runtime === undefined) return listenOnNode(options)
  const server = options.runtime.createServer(options.handler)
  return new Promise((resolve) => server.listen(options.port, () => resolve(server)))
}

export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

/** Something that emits the shutdown signals: `process` in production, an EventEmitter in tests. */
export interface SignalSource {
  on(event: ShutdownSignal | 'exit', listener: () => void): unknown
  off(event: ShutdownSignal | 'exit', listener: () => void): unknown
}

export interface ShutdownOptions {
  readonly signals: SignalSource
  readonly stopAll: () => Promise<void>
  readonly closeServer: () => Promise<void>
  readonly exit: (code: number) => void
  readonly write: (line: string) => void
}

/**
 * On the first SIGINT or SIGTERM: stop every runner (each drains its in-flight turns), close the
 * server, exit 0. A second signal while stopping is written and ignored. A runner that fails to
 * stop, or a server that fails to close, is written and the exit code is 1. Returns what removes
 * the listeners.
 */
export function installShutdown(options: ShutdownOptions): () => void {
  let stopping = false
  const shutdown = async (): Promise<number> => {
    let code = 0
    try {
      await options.stopAll()
    } catch (error) {
      code = 1
      options.write(`shutdown: stopping the runners failed: ${describeError(error)}`)
    }
    try {
      await options.closeServer()
    } catch (error) {
      code = 1
      options.write(`shutdown: closing the server failed: ${describeError(error)}`)
    }
    return code
  }
  const listenerFor = (signal: ShutdownSignal) => (): void => {
    if (stopping) {
      options.write(`shutdown: ${signal} ignored, already stopping`)
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
