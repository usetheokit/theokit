import { describe, expect, it } from 'vitest'
import { HostError } from '../src/index.js'

describe('HostError', () => {
  it('is an Error and a HostError carrying a code and message', () => {
    const error = new HostError('host_test', 'message')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(HostError)
    expect(error.code).toBe('host_test')
    expect(error.message).toBe('message')
    expect(error.name).toBe('HostError')
  })

  it('keeps the cause', () => {
    const cause = new Error('root')
    expect(new HostError('host_test', 'message', { cause }).cause).toBe(cause)
  })

  it('has no cause when none is given', () => {
    expect('cause' in new HostError('host_test', 'message')).toBe(false)
  })
})
