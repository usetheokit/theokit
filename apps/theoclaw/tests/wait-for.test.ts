import { describe, expect, it } from 'vitest'

import { waitFor } from './fakes.js'

describe('waitFor', () => {
  it('describes the state at the deadline, not the state when the wait began', async () => {
    let screen = 'Thinking…'
    setTimeout(() => (screen = 'the turn ended'), 5)
    await expect(waitFor(() => false, 30, () => `screen: ${screen}`)).rejects.toThrow(
      'timed out after 30 ms waiting for screen: the turn ended',
    )
  })

  it('still takes a plain description', async () => {
    await expect(waitFor(() => false, 1, 'the card')).rejects.toThrow('timed out after 1 ms waiting for the card')
  })
})
