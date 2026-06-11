/**
 * Bun runtime adapter — zero conversion.
 *
 * Bun.serve() already accepts `fetch(req: Request): Response`.
 * This adapter is a trivial passthrough — the pipeline IS the handler.
 *
 * Usage:
 * ```ts
 * const adapter = createBunAdapter()
 * const handle = adapter.createServer(handler)
 * handle.listen(3000)
 * ```
 *
 * Note: only works when `typeof Bun !== 'undefined'` (Bun runtime).
 * On Node.js, use createNodeAdapter() instead.
 */
import type { RuntimeAdapter, ServerHandle } from './types.js'

/** Create a Bun-native adapter — zero Request/Response conversion. */
export function createBunAdapter(): RuntimeAdapter {
  if (typeof globalThis.Bun === 'undefined') {
    throw new Error(
      '[@theokit/http] createBunAdapter() requires Bun runtime. ' +
        'Use createNodeAdapter() for Node.js.',
    )
  }

  return {
    createServer(handler) {
      let server: ReturnType<typeof Bun.serve> | null = null

      const handle: ServerHandle = {
        listen(port: number, callback?: () => void) {
          server = Bun.serve({
            port,
            fetch: handler,
          })
          if (callback) callback()
        },
        close(callback?: () => void) {
          server?.stop()
          if (callback) callback()
        },
        address() {
          if (!server) return null
          return { port: server.port }
        },
      }

      return handle
    },
  }
}

// Bun global type augmentation for TypeScript
declare global {
   
  var Bun: {
    serve(options: {
      port: number
      fetch: (request: Request) => Response | Promise<Response>
    }): { port: number; stop(): void }
  } | undefined
}
