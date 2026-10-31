import { Bonjour, type Service, type ServiceConfig } from 'bonjour-service'

import {
  type DiscoveryErrorRoute,
  type PublishedService,
  type ServicePublisher,
  TheoClawDiscoveryError,
} from './publisher.js'

type SendCallback = (error?: unknown, ...rest: unknown[]) => void

/** The part of the library's multicast emitter the adapter observes. */
interface MdnsEmitter {
  on(event: 'error', listener: (error: unknown) => void): unknown
  send(value: { readonly type?: string }, rinfo?: unknown, callback?: SendCallback): void
}

export interface BonjourPublisherOptions {
  onError(error: TheoClawDiscoveryError): void
  /** The interface the multicast socket binds; only the adapter's own tests set it. */
  readonly interface?: string
  /** The address packets are sent to; only the adapter's own tests set it. */
  readonly ip?: string
}

/**
 * The emitter sits on `server`, a member the library's types mark private. This cast is the one
 * access to it, and is why the dependency is pinned at exactly 1.4.4 (plan D1): a release that moves
 * the member fails `tests/lan-publisher.test.ts`.
 */
function emitterOf(bonjour: Bonjour): MdnsEmitter {
  return (bonjour as unknown as { readonly server: { readonly mdns: MdnsEmitter } }).server.mdns
}

/**
 * Every packet the library sends goes through the emitter's `send`, announcements and probe queries
 * included, whose callers ignore the callback's error. Wrapping `send` is what keeps a host that
 * cannot send from claiming it publishes (plan D5). The wrapper normalises the arguments itself, so
 * the original never calls back into it and each packet is seen once.
 */
function observeSends(emitter: MdnsEmitter, report: (error: unknown, route: DiscoveryErrorRoute) => void): void {
  const send = emitter.send.bind(emitter)
  emitter.send = (value, rinfo, callback) => {
    const done = typeof rinfo === 'function' ? (rinfo as SendCallback) : callback
    const target = typeof rinfo === 'function' ? null : rinfo
    const route = value.type === 'query' ? 'send-query' : 'send-respond'
    try {
      send(value, target, (error, ...rest) => {
        if (error) report(error, route)
        done?.(error, ...rest)
      })
    } catch (error) {
      report(error, route)
    }
  }
}

/** The cause of a conflict: `codeOf` reads its `code`, and the message names the contested name (plan D2). */
function nameInUse(name: string): Error & { readonly code: 'NAME_IN_USE' } {
  return Object.assign(new Error(`mDNS name "${name}" is already in use on the network`), {
    code: 'NAME_IN_USE' as const,
  })
}

/**
 * The library answers a probe that finds the name taken only by calling the service's own `stop` and
 * writing `console.log`; TheoClaw's withdrawals go through `unpublishAll`, never `stop`. So a `stop`
 * outside a withdrawal is the conflict, reported before the library tears the service down, which it
 * does even if the report throws (plan D1). The probe answers asynchronously, so the wrap is in place
 * before any answer can arrive. `withdrawing` is never cleared: a probe answer can still arrive after
 * `unpublishAll` resolved, and that late `stop` is TheoClaw's withdrawal, not a conflict.
 */
function observeConflict(published: Service, withdrawing: () => boolean, onConflict: () => void): void {
  const stop = published.stop?.bind(published)
  published.stop = (callback?: CallableFunction) => {
    try {
      if (!withdrawing()) onConflict()
    } finally {
      stop?.(callback)
    }
  }
}

/**
 * The one adapter over the DNS-SD library. Both of its error routes, the socket's `error` event and
 * the answer path's `errorCallback`, are wired in the constructing tick; the library's default for
 * either exits the process (FR-006).
 */
export function createBonjourPublisher(options: BonjourPublisherOptions): ServicePublisher {
  const { onError, interface: iface, ip } = options
  const report = (error: unknown, route: DiscoveryErrorRoute): void => {
    onError(new TheoClawDiscoveryError(error, route))
  }
  const config = { ...(iface === undefined ? {} : { interface: iface }), ...(ip === undefined ? {} : { ip }) }
  const bonjour = new Bonjour(config as Partial<ServiceConfig>, (error: unknown) => report(error, 'answer'))
  try {
    const emitter = emitterOf(bonjour)
    emitter.on('error', (error) => report(error, 'socket'))
    observeSends(emitter, report)
  } catch (error) {
    // Without its listeners the instance must not keep a socket open: release it, then refuse.
    bonjour.destroy()
    throw error
  }

  let withdrawing = false
  return {
    publish: (service: PublishedService) => {
      const published = bonjour.publish({
        name: service.name,
        type: service.type,
        port: service.port,
        txt: { ...service.txt },
      })
      observeConflict(published, () => withdrawing, () => report(nameInUse(service.name), 'publish'))
    },
    unpublishAll: () =>
      new Promise<void>((resolve, reject) => {
        withdrawing = true
        bonjour.unpublishAll((error?: unknown) => {
          if (error) reject(new TheoClawDiscoveryError(error, 'send-respond'))
          else resolve()
        })
      }),
    destroy: () =>
      new Promise<void>((resolve, reject) => {
        withdrawing = true
        try {
          bonjour.destroy(() => resolve())
        } catch (error) {
          reject(new TheoClawDiscoveryError(error, 'socket'))
        }
      }),
  }
}
