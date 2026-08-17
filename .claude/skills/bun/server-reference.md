# Bun.serve — HTTP Server & WebSocket Reference

## Bun.serve Options

```ts
Bun.serve({
  port?: number;             // default: $BUN_PORT > $PORT > $NODE_PORT > 3000. 0 = random
  hostname?: string;         // default: "0.0.0.0"
  unix?: string;             // Unix domain socket path ("\0name" for abstract namespace)
  idleTimeout?: number;      // seconds (default 10, max 255, 0 = disable)
  development?: boolean;     // enables debug mode
  http3?: boolean;           // experimental QUIC (requires TLS)
  http1?: boolean;           // set false with http3 for QUIC-only

  tls?: {
    key?: string | Buffer | BunFile | Array;
    cert?: string | Buffer | BunFile | Array;
    ca?: string | Buffer | BunFile | Array;
    passphrase?: string;
    dhParamsFile?: string;
    lowMemoryMode?: boolean;
    serverName?: string;
    secureOptions?: number;
  };

  routes?: Record<string, RouteHandler>;  // v1.2.3+
  fetch(req: Request, server: Server): Response | Promise<Response>;
  error?(error: Error): Response | Promise<Response>;
  websocket?: WebSocketHandler;
});
```

## Route Patterns

```ts
routes: {
  "/static": new Response("text"),                    // static response
  "/static": Bun.file("./file.html"),                 // serve file
  "/redirect": Response.redirect("/target"),           // redirect
  "/dynamic/:id": req => new Response(req.params.id), // URL params
  "/api/resource": {                                   // per-method
    GET: () => Response.json([]),
    POST: async req => Response.json(await req.json()),
    PUT: handler, DELETE: handler,
  },
  "/catch/*": handler,                                // wildcard
}
```

## Server Instance

```ts
interface Server {
  readonly url: URL;
  readonly port: number;
  readonly hostname: string;
  readonly development: boolean;
  readonly id: string;
  readonly pendingRequests: number;
  readonly pendingWebSockets: number;

  stop(closeActiveConnections?: boolean): Promise<void>;
  reload(options: Partial<ServeOptions>): void;  // only fetch, error, routes
  fetch(req: Request | string): Response | Promise<Response>;
  requestIP(req: Request): { address: string; port: number; family: string } | null;
  timeout(req: Request, seconds: number): void;  // 0 = disable for this request
  ref(): void;
  unref(): void;

  // WebSocket
  upgrade<T>(req: Request, options?: { headers?: HeadersInit; data?: T }): boolean;
  publish(topic: string, data: string | ArrayBufferView | ArrayBuffer, compress?: boolean): number;
  subscriberCount(topic: string): number;
}
```

## Server-Sent Events (SSE)

```ts
Bun.serve({
  routes: {
    "/events": (req, server) => {
      server.timeout(req, 0); // disable idle timeout for streaming
      return new Response(
        async function* () {
          while (true) {
            yield `data: ${JSON.stringify({ time: Date.now() })}\n\n`;
            await Bun.sleep(1000);
          }
        },
        { headers: { "Content-Type": "text/event-stream" } }
      );
    },
  },
});
```

## Export Default Syntax

```ts
// server.ts — auto-detected by Bun as server
import type { Serve } from "bun";

export default {
  port: 3000,
  fetch(req) { return new Response("Hello"); },
} satisfies Serve.Options<undefined>;
```

## HTML Imports (Full-Stack)

```ts
import app from "./index.html";

Bun.serve({
  routes: { "/": app },  // dev: HMR, prod: pre-built manifest
});
```

Dev: `bun --hot server.ts` (auto-bundle + HMR)
Prod: `bun build --target=bun server.ts` then `bun server.js`

---

# WebSocket Reference

## Server Setup

```ts
Bun.serve({
  fetch(req, server) {
    if (server.upgrade(req, {
      headers: { "Set-Cookie": "session=abc" },
      data: { userId: 123, room: "chat" },
    })) return;
    return new Response("Not a WebSocket", { status: 400 });
  },

  websocket: {
    // Type ws.data (replaces generic type parameter)
    data: {} as { userId: number; room: string },

    open(ws) {
      ws.subscribe("chat");
      ws.send("Welcome!");
    },
    message(ws, message) {
      // message: string | Buffer
      ws.publish("chat", `User ${ws.data.userId}: ${message}`);
    },
    close(ws, code, reason) {
      ws.unsubscribe("chat");
    },
    drain(ws) { /* ready for more data */ },

    // Configuration
    maxPayloadLength: 16 * 1024 * 1024,  // 16 MB default
    idleTimeout: 120,                     // seconds, default 120
    backpressureLimit: 1024 * 1024,       // 1 MB default
    closeOnBackpressureLimit: false,
    sendPings: true,
    publishToSelf: false,

    perMessageDeflate: true,  // or { compress: "shared", decompress: "shared" }
  },
});
```

## ServerWebSocket API

```ts
interface ServerWebSocket<T> {
  readonly data: T;
  readonly readyState: number;
  readonly remoteAddress: string;
  readonly subscriptions: string[];

  send(message: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
  // Returns: -1 (backpressure), 0 (dropped), 1+ (bytes sent)

  close(code?: number, reason?: string): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, message: string | ArrayBuffer | Uint8Array): void;
  isSubscribed(topic: string): boolean;
  cork(cb: (ws: ServerWebSocket<T>) => void): void;
}
```

## Client WebSocket

```ts
// Standard browser API + Bun extensions
const ws = new WebSocket("ws://localhost:3000");
const ws = new WebSocket("ws://localhost:3000", {
  headers: { "Authorization": "Bearer token" },  // Bun extension
});

ws.addEventListener("open", () => { });
ws.addEventListener("message", event => console.log(event.data));
ws.addEventListener("close", event => { });
ws.addEventListener("error", event => { });
```

## Compression Options

```ts
type Compressor =
  | "disable" | "shared" | "dedicated"
  | "3KB" | "4KB" | "8KB" | "16KB" | "32KB" | "64KB" | "128KB" | "256KB";

perMessageDeflate: {
  compress: Compressor | boolean;
  decompress: Compressor | boolean;
}
```
