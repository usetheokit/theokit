import { createWebhookHandler } from '@theokit/gateway'
import type { BasePlatformAdapter, BuiltChannel, OutboundMessage, PlatformName } from '@theokit/gateway'
import { LineAdapter } from '@theokit/gateway-line'

import { createWebhookRouter, webhookPlatformOf } from '../src/webhooks/router.js'
import type { WebhookRoute } from '../src/webhooks/router.js'
import { FakeAdapter } from './fakes.js'

/**
 * The router the composition builds, over the given built channels: the gateway's webhook handler
 * for `/webhooks/<platform>`, the trigger and named routes beside it. `isStarted` is the runner's
 * view of which platforms are up.
 */
export function gatewayRouter(options: {
  readonly channels: readonly BuiltChannel[]
  readonly isStarted: (platform: PlatformName) => boolean
  readonly write?: (line: string) => void
  readonly named?: ReadonlyMap<string, WebhookRoute>
}): (request: Request) => Promise<Response> {
  const write = options.write ?? (() => undefined)
  return createWebhookRouter({
    channels: createWebhookHandler({
      channels: options.channels,
      isStarted: options.isStarted,
      platformFor: webhookPlatformOf,
      onError: (platform, error) => write(`${platform}: webhook failed: ${error instanceof Error ? error.message : String(error)}`),
    }),
    write,
    ...(options.named === undefined ? {} : { named: options.named }),
  })
}

/**
 * Stand-in channels for the router's own behaviour: each route answers as the platform's
 * `webhook.handle`, over the request the gateway's handler rebuilt from its capped body.
 */
function routeChannels(routes: ReadonlyMap<PlatformName, WebhookRoute>): BuiltChannel[] {
  return [...routes].map(([platform, route]) => {
    const adapter = new FakeAdapter(platform)
    return {
      adapter,
      descriptor: {
        platform,
        transport: 'webhook',
        config: [],
        create: () => adapter,
        webhook: {
          methods: route.methods,
          verify: () => true,
          ingest: async () => 'delivered',
          handle: async (_adapter, request) => {
            const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
            const response = await route.handle(
              new Request(request.url ?? 'http://localhost/', {
                method: request.method ?? 'POST',
                headers: Object.entries(request.headers).flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as [string, string]])),
                ...(hasBody ? { body: request.rawBody } : {}),
              }),
            )
            return { status: response.status, body: await response.text() }
          },
        },
      },
    }
  })
}

/** The router over `routes` served by the gateway's webhook handler, as the composition serves its platforms. */
export function routerOf(options: {
  readonly routes: ReadonlyMap<PlatformName, WebhookRoute>
  readonly isStarted: (platform: PlatformName) => boolean
  readonly write: (line: string) => void
}): (request: Request) => Promise<Response> {
  return gatewayRouter({ channels: routeChannels(options.routes), isStarted: options.isStarted, write: options.write })
}

/** A real adapter with no network: it connects at once, disconnects at once, and keeps what it was asked to send. */
export function offline<T extends BasePlatformAdapter>(adapter: T): T & { readonly sent: OutboundMessage[]; connects: number; disconnects: number } {
  const sent: OutboundMessage[] = []
  const stub = Object.assign(adapter, {
    sent,
    connects: 0,
    disconnects: 0,
    connect: async () => {
      stub.connects += 1
      return true
    },
    disconnect: async () => {
      stub.disconnects += 1
    },
    sendMessage: async (message: OutboundMessage) => {
      sent.push(message)
      return { ok: true as const, messageId: `sent-${sent.length}` }
    },
  })
  return stub
}

/** The LINE adapter the descriptor builds, offline; a group message reaches the handler without a mention, as in TheoClaw. */
export function offlineLine(channelSecret: string) {
  return offline(new LineAdapter({ channelSecret, channelAccessToken: 'line-access-token', requireMention: false }))
}
