import { describe, expect, it } from 'vitest'
import { AppHostStartError, createAppHost } from '../../src/app-host/index.js'

describe('app host rollback', () => {
  it('stops started services in reverse when a later start throws', async () => {
    const log: string[] = []
    const boom = new Error('boom')
    const host = createAppHost()
    host.service(
      'A',
      () => 1,
      () => {
        log.push('stop A')
      },
    )
    host.service(
      'B',
      () => 1,
      () => {
        log.push('stop B')
      },
    )
    host.service(
      'C',
      () => {
        throw boom
      },
      () => {
        log.push('stop C')
      },
    )
    const error = await host.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppHostStartError)
    const start = error as AppHostStartError
    expect(start.step).toBe('C')
    expect(start.cause).toBe(boom)
    expect(start.rollbackFailures).toEqual([])
    expect(log).toEqual(['stop B', 'stop A'])
  })

  it('reports rollback failures and keeps rolling back', async () => {
    const log: string[] = []
    const bad = new Error('stop failed')
    const host = createAppHost()
    host.service(
      'A',
      () => 1,
      () => {
        log.push('stop A')
      },
    )
    host.service(
      'B',
      () => 1,
      () => {
        throw bad
      },
    )
    host.service('C', () => {
      throw new Error('x')
    })
    const error = (await host.start().catch((e: unknown) => e)) as AppHostStartError
    expect(error.rollbackFailures).toEqual([{ step: 'B', error: bad }])
    expect(log).toEqual(['stop A'])
  })
})
