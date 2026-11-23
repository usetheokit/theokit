import { describe, expect, it } from 'vitest'
import { finishedOnce } from './finished-once.js'

describe('finishedOnce', () => {
  it('counts a finished run once however many times it is waited on', async () => {
    let count = 0
    const wait = finishedOnce(async () => ({ status: 'finished' }), () => void (count += 1))
    await Promise.all([wait(), wait()])
    await wait()
    expect(count).toBe(1)
  })

  it('does not count a run that did not finish', async () => {
    let count = 0
    const wait = finishedOnce(async () => ({ status: 'cancelled' }), () => void (count += 1))
    await wait()
    expect(count).toBe(0)
  })
})
