import { describe, expect, it, vi } from 'vitest'

interface FakeService {
  stop?: (callback?: CallableFunction) => void
}
interface FakeEmitter {
  handlers: Array<(error: unknown) => void>
  on(event: 'error', listener: (error: unknown) => void): void
  send(value: unknown, rinfo?: unknown, callback?: (error?: unknown) => void): void
}
const state: {
  emitter?: FakeEmitter
  services: FakeService[]
  errorCallback?: (error: unknown) => void
} = {
  services: [],
}

vi.mock('bonjour-service', () => ({
  Bonjour: class {
    server: { mdns: FakeEmitter }
    constructor(_config: unknown, errorCallback: (error: unknown) => void) {
      state.errorCallback = errorCallback
      const emitter: FakeEmitter = {
        handlers: [],
        on(_event, listener) {
          emitter.handlers.push(listener)
        },
        send(_value, _rinfo, callback) {
          callback?.()
        },
      }
      state.emitter = emitter
      this.server = { mdns: emitter }
    }
    publish(): FakeService {
      const service: FakeService = { stop: (callback) => callback?.() }
      state.services.push(service)
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

const { announceService } = await import('../../src/discovery/index.js')
const { createBonjourPublisher } = await import('../../src/discovery-bonjour/index.js')

const announce = (onError: (error: unknown) => void) => {
  const direct = vi.fn()
  const publisher = createBonjourPublisher({ onError: direct })
  const result = announceService({
    type: 'x',
    name: 'n',
    port: 1,
    host: '10.0.0.2',
    publisher,
    onError,
  })
  return { direct, result }
}

describe('createBonjourPublisher', () => {
  it('survives a socket error after publish and reports it once', async () => {
    const onError = vi.fn()
    const { direct } = announce(onError)
    const error = Object.assign(new Error('bind'), { code: 'EADDRNOTAVAIL' })
    for (const handler of state.emitter!.handlers) handler(error)
    for (const handler of state.emitter!.handlers) handler(error)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(direct).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      name: 'DiscoveryError',
      code: 'EADDRNOTAVAIL',
      route: 'socket',
    })
  })

  it('reports a name conflict to announceService after stopping', async () => {
    const onError = vi.fn()
    announce(onError)
    state.services.at(-1)!.stop!()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'NAME_IN_USE', route: 'publish' })
  })

  it('does not call a withdrawal a conflict', async () => {
    const onError = vi.fn()
    const { result } = announce(onError)
    await result.stop()
    state.services.at(-1)!.stop!()
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports answer-path and send errors', async () => {
    const onError = vi.fn()
    announce(onError)
    state.emitter!.send({ type: 'query' }, undefined, undefined)
    state.errorCallback!(Object.assign(new Error('x'), { code: 'EACCES' }))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'EACCES', route: 'answer' })
  })
})
