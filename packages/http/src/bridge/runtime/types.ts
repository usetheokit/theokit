/**
 * RuntimeAdapter — abstraction layer between Web Standard pipeline and runtime server APIs.
 *
 * Per ADR D460: the pipeline operates on Web Standard Request/Response.
 * Each runtime adapter converts its native server API to/from these types.
 */

export interface RuntimeAdapter {
  /** Create an HTTP server that delegates to a Web Standard handler. */
  createServer(handler: (request: Request) => Response | Promise<Response>): ServerHandle
}

export interface ServerHandle {
  /** Bind to `host` (default loopback 127.0.0.1). */
  listen(port: number, callback?: () => void, host?: string): void
  close(callback?: () => void): void
  address(): { port: number } | null
}
