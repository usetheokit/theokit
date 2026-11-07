import { describe, expect, it, vi } from 'vitest'

interface FakeService {
  stop?: (callback?: CallableFunction) => void
}
const services: FakeService[] = []

vi.mock('bonjour-service', () => ({
  Bonjour: class {
    server = { mdns: { on: () => undefined, send: () => undefined } }
    publish(): FakeService {
      const service: FakeService = { stop: (callback) => callback?.() }
      services.push(service)
      return service
    }
    unpublishAll(callback?: () => void): void {
      callback?.()
    }
    destroy(callback?: () => void): void {
      callback?.()
    }
  },
}))

const { createBonjourPublisher } = await import('../src/discovery/bonjour-publisher.js')

const svc = (name: string) => ({ name, type: 'theoclaw', port: 40000, txt: {} })

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
})
