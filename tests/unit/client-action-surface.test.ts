/**
 * usetheokit/theokit#453 — the wiring test: `theokit/client` is enough on its own.
 *
 * `useAction` hands back an `ActionError`, and a component that wants to tell a validation failure
 * from a conflict has to narrow it. Until this shipped, the only public export of that hierarchy was
 * `theokit/server` — so narrowing the error of a client hook meant importing the server barrel into
 * a browser bundle, to read a class that lives in `core/contracts/` and depends on nothing.
 */
import { describe, it, expect } from 'vitest'

describe('the client barrel carries the whole action surface', () => {
  it('exports the hook and its store', async () => {
    const client = await import('../../packages/theo/src/client/index.js')

    expect(typeof client.useAction).toBe('function')
    expect(typeof client.ActionClient).toBe('function')
  })

  it('exports the error hierarchy the hook returns, so narrowing needs no server import', async () => {
    const client = await import('../../packages/theo/src/client/index.js')

    expect(typeof client.ActionError).toBe('function')
    expect(typeof client.ActionInputError).toBe('function')
    expect(typeof client.isActionError).toBe('function')
    expect(typeof client.isInputError).toBe('function')
  })

  it('serves the same class object as the server barrel, so instanceof holds across both', async () => {
    const [client, server] = await Promise.all([
      import('../../packages/theo/src/client/index.js'),
      import('../../packages/theo/src/server/index.js'),
    ])

    // Two copies of the class would make `instanceof` fail for an error raised on one side and
    // narrowed on the other — the failure mode a duplicated module graph produces silently.
    expect(client.ActionError).toBe(server.ActionError)
    expect(client.ActionInputError).toBe(server.ActionInputError)
  })

  it('narrows a validation failure to its field map through the client entry alone', async () => {
    const { ActionClient, isInputError } = await import('../../packages/theo/src/client/index.js')

    const store = new ActionClient(async () => ({
      data: undefined,
      error: { type: 'TheoActionInputError', issues: [{ path: ['email'], message: 'Required' }] },
    }))
    await store.mutateAsync({}).catch(() => undefined)

    const error = store.getSnapshot().error
    expect(isInputError(error)).toBe(true)
    expect(error).toHaveProperty('fields', { email: ['Required'] })
  })
})
