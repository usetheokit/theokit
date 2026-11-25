import type { PublishedService } from '../src/discovery/publisher.js'
import { describe, expect, it, vi } from 'vitest'

interface FakeService {
  stop?: (callback?: CallableFunction) => void
}
const services: FakeService[] = []
let goodbyeError: (Error & { code?: string }) | undefined

vi.mock('bonjour-service', () => ({
  Bonjour: class {
    server = { mdns: { on: () => undefined, send: () => undefined } }
    publish(): FakeService {
      const service: FakeService = { stop: (callback) => callback?.() }
      services.push(service)
      return service
    }
    unpublishAll(callback?: (error?: Error) => void): void {
      callback?.(goodbyeError)
    }
    destroy(callback?: () => void): void {
      callback?.()
    }
  },
}))

const { createBonjourPublisher } = await import('../src/discovery/lan-publisher.js')

const svc = (name: string): PublishedService => ({ name, type: 'theoclaw', port: 40000, txt: { path: '/control' } })

/** B-613: a withdrawal covers the services published before it, not one published afterwards. */
describe('createBonjourPublisher conflict after a withdrawal (offline)', () => {
  it('reports a conflict on a service published after unpublishAll', async () => {
    const errors: { code: string }[] = []
    const publisher = createBonjourPublisher({ onError: (error) => errors.push(error) })
    publisher.publish(svc('before'))
    await publisher.unpublishAll()
    services[0]?.stop?.() // late probe answer for the withdrawn service: not a conflict
    expect(errors).toEqual([])

    publisher.publish(svc('after'))
    services[1]?.stop?.() // the library stops it because the name is taken
    expect(errors.map((error) => error.code)).toEqual(['NAME_IN_USE'])
  })

  it('rejects unpublishAll with the shared DiscoveryError when the goodbye send fails', async () => {
    const publisher = createBonjourPublisher({ onError: () => undefined })
    publisher.publish(svc('goodbye'))
    goodbyeError = Object.assign(new Error('send EACCES'), { code: 'EACCES' })
    try {
      await expect(publisher.unpublishAll()).rejects.toMatchObject({
        name: 'DiscoveryError',
        code: 'EACCES',
        route: 'send-respond',
      })
    } finally {
      goodbyeError = undefined
    }
  })
})
