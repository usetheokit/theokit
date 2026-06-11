/**
 * Deno runtime adapter — zero conversion (like Bun).
 *
 * Deno.serve() accepts `(request: Request) => Response | Promise<Response>`
 * — identical to our pipeline handler. No conversion needed.
 *
 * EC-1: close() chains shutdown() promise before firing callback.
 */
import type { RuntimeAdapter, ServerHandle } from './types.js'

/** Create a Deno-native adapter — zero Request/Response conversion. */
export function createDenoAdapter(): RuntimeAdapter {
  if (typeof globalThis.Deno === 'undefined') {
    throw new Error(
      '[@theokit/http] createDenoAdapter() requires Deno runtime. ' +
        'Use createNodeAdapter() for Node.js or createBunAdapter() for Bun.',
    )
  }

  return {
    createServer(handler) {
      let server: { port: number; shutdown(): Promise<void> } | null = null

      const handle: ServerHandle = {
        listen(port: number, callback?: () => void) {
          server = Deno.serve({ port, onListen: () => callback?.() }, handler)
        },
        close(callback?: () => void) {
          // EC-1: shutdown() returns Promise — chain callback
          if (server) {
            void server.shutdown().then(() => callback?.())
          } else if (callback) {
            callback()
          }
        },
        address() {
          return server ? { port: server.port } : null
        },
      }

      return handle
    },
  }
}

// Deno global type augmentation
declare global {
   
  var Deno: {
    serve(
      options: { port: number; onListen?: () => void },
      handler: (request: Request) => Response | Promise<Response>,
    ): { port: number; shutdown(): Promise<void> }
    version: { deno: string }
  } | undefined
}
