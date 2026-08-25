/**
 * usetheokit/theokit#453 — the store behind `useAction`.
 *
 * The framework generates a typed action callable, serves it at `/api/__actions/`, and defines the
 * error hierarchy it answers with — and then had no way to call one from a component. That gap is
 * why `@theokit/plugin-forms` depends on `@theokit/react@1.1.0`: one version, published once in
 * June, no `repository` field, and a `@theokit/sdk ^1.1.0` peer against a published 4.x.
 *
 * The logic lives in this store rather than in the hook, following `useAgent` — the state machine
 * is testable without a DOM, and a non-React surface can subscribe to it directly.
 */
import { describe, it, expect, vi } from 'vitest'

import { ActionClient } from '../../packages/theo/src/client/action-client.js'
import {
  ActionError,
  ActionInputError,
} from '../../packages/theo/src/core/contracts/action-protocol.js'

/**
 * A callable shaped like the one `@theo/actions` generates. The generated facade always returns
 * BOTH keys — `{data: undefined, error: json}` on failure — so the helper does too; a fixture that
 * omitted one would be testing a shape the framework never emits.
 */
function envelopeAction(result: { data?: unknown; error?: unknown }) {
  return vi.fn(async () => ({ data: undefined, error: undefined, ...result }) as never)
}

describe('ActionClient — the state machine', () => {
  it('starts idle with nothing recorded', () => {
    const client = new ActionClient(envelopeAction({ data: 1 }))
    const state = client.getSnapshot()

    expect(state.status).toBe('idle')
    expect(state.data).toBeUndefined()
    expect(state.error).toBeUndefined()
    expect(state.variables).toBeUndefined()
  })

  it('records the input as variables while the call is pending', async () => {
    let release: (v: { data: string; error: undefined }) => void = () => {}
    const action = vi.fn(
      () => new Promise<{ data: string; error: undefined }>((r) => (release = r)),
    )
    const client = new ActionClient(action as never)

    const inFlight = client.mutateAsync({ name: 'ada' })
    expect(client.getSnapshot().status).toBe('pending')
    expect(client.getSnapshot().variables).toEqual({ name: 'ada' })

    release({ data: 'ok', error: undefined })
    await inFlight

    expect(client.getSnapshot().status).toBe('success')
    expect(client.getSnapshot().data).toBe('ok')
  })

  it('treats an object carrying only an error key as data, since the envelope has both', async () => {
    // The boundary is worth pinning: the generated facade always emits both keys, so requiring
    // both is what distinguishes an envelope from a payload that merely has a field named `error`.
    const payload = { error: 'the field the form is about' }
    const client = new ActionClient(vi.fn(async () => payload) as never)

    await client.mutateAsync(undefined)

    expect(client.getSnapshot().status).toBe('success')
    expect(client.getSnapshot().data).toBe(payload)
  })

  it('treats a callable that resolves a bare value as data, not as an envelope', async () => {
    const client = new ActionClient(vi.fn(async () => 42) as never)

    await client.mutateAsync(undefined)

    expect(client.getSnapshot().data).toBe(42)
    expect(client.getSnapshot().error).toBeUndefined()
  })
})

describe('ActionClient — errors arrive typed', () => {
  it('turns a serialized action error into an ActionError with its code and status', async () => {
    const client = new ActionClient(
      envelopeAction({
        error: { type: 'TheoActionError', code: 'FORBIDDEN', message: 'not yours' },
      }),
    )

    await expect(client.mutateAsync({})).rejects.toBeInstanceOf(ActionError)

    const { error } = client.getSnapshot()
    expect(error).toBeInstanceOf(ActionError)
    expect(error?.code).toBe('FORBIDDEN')
    expect(error?.status).toBe(403)
    expect(error?.message).toBe('not yours')
  })

  it('turns a validation error into an ActionInputError carrying the field map', async () => {
    const client = new ActionClient(
      envelopeAction({
        error: {
          type: 'TheoActionInputError',
          issues: [{ path: ['email'], message: 'Invalid email' }],
        },
      }),
    )

    await expect(client.mutateAsync({})).rejects.toBeInstanceOf(ActionInputError)

    const error = client.getSnapshot().error
    expect(error).toBeInstanceOf(ActionInputError)
    expect((error as ActionInputError).fields).toEqual({ email: ['Invalid email'] })
  })

  it('keeps the field map of a validation error that arrived without its issues', async () => {
    // The wire carries BOTH `issues` and `fields` (server/http/serialize-action-result.ts:60),
    // and `ActionError.fromJson` reads `issues`. A hand-written action — or a test fixture — that
    // produces the field map directly is the shape that has no issues to read, and dropping it
    // turned a validation failure into INTERNAL_SERVER_ERROR with the map gone. `fields` is the
    // whole reason a form library subscribes to this error, so losing it silently is the worst
    // available outcome. Found by @theokit/plugin-forms' own suite.
    const client = new ActionClient(
      envelopeAction({
        error: {
          type: 'TheoActionInputError',
          code: 'VALIDATION_ERROR',
          status: 422,
          fields: { email: ['Email is already taken'] },
        },
      }),
    )

    await expect(client.mutateAsync({})).rejects.toBeInstanceOf(ActionInputError)

    const error = client.getSnapshot().error
    expect(error).toBeInstanceOf(ActionInputError)
    expect((error as ActionInputError).fields).toEqual({ email: ['Email is already taken'] })
  })

  it('rebuilds a nested field path from the map, dots and array indices intact', async () => {
    const client = new ActionClient(
      envelopeAction({
        error: {
          type: 'TheoActionInputError',
          fields: { 'items.0.name': ['Required'], '': ['Form is invalid'] },
        },
      }),
    )

    await expect(client.mutateAsync({})).rejects.toThrow()

    // Root errors key on the empty string and array indices stay numeric segments — the
    // convention `buildFieldsMap` documents. A naive split/join would lose one of them.
    expect(client.getSnapshot().error).toHaveProperty('fields', {
      'items.0.name': ['Required'],
      '': ['Form is invalid'],
    })
  })

  it('keeps the message of an error whose code the protocol does not define', async () => {
    // The generated facade answers `{code:'NETWORK_ERROR', message:'fetch failed'}` when `fetch`
    // itself rejects. NETWORK_ERROR is not an ActionErrorCode, so the code is normalized — but
    // dropping the message with it would leave the consumer holding "INTERNAL_SERVER_ERROR" and
    // nothing about what happened.
    const client = new ActionClient(
      envelopeAction({ error: { code: 'NETWORK_ERROR', message: 'fetch failed' } }),
    )

    await expect(client.mutateAsync({})).rejects.toThrow()

    expect(client.getSnapshot().error?.message).toBe('fetch failed')
  })

  it('normalizes a callable that throws instead of resolving an envelope', async () => {
    const client = new ActionClient(
      vi.fn(async () => {
        throw new Error('boom')
      }) as never,
    )

    await expect(client.mutateAsync({})).rejects.toThrow('boom')

    expect(client.getSnapshot().status).toBe('error')
    expect(client.getSnapshot().error?.message).toBe('boom')
  })

  it('lets mutate report the failure in state without producing an unhandled rejection', async () => {
    const client = new ActionClient(
      envelopeAction({ error: { type: 'TheoActionError', code: 'CONFLICT' } }),
    )

    client.mutate({})
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('error'))

    expect(client.getSnapshot().error?.code).toBe('CONFLICT')
  })
})

describe('ActionClient — a superseded call never wins', () => {
  it('discards the result of a call that a newer one has already replaced', async () => {
    let releaseFirst: (v: unknown) => void = () => {}
    let releaseSecond: (v: unknown) => void = () => {}
    const action = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (releaseFirst = r)))
      .mockImplementationOnce(() => new Promise((r) => (releaseSecond = r)))
    const client = new ActionClient(action as never)

    const first = client.mutateAsync({ n: 1 })
    const second = client.mutateAsync({ n: 2 })

    // The SECOND settles first, then the first arrives late — the ordering a slow network
    // produces on a form submitted twice.
    releaseSecond({ data: 'second', error: undefined })
    await second
    releaseFirst({ data: 'first', error: undefined })
    await first

    expect(client.getSnapshot().data).toBe('second')
    expect(client.getSnapshot().variables).toEqual({ n: 2 })
  })

  it('does not let a late failure overwrite a newer success', async () => {
    let releaseFirst: (v: unknown) => void = () => {}
    const action = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (releaseFirst = r)))
      .mockImplementationOnce(async () => ({ data: 'second', error: undefined }))
    const client = new ActionClient(action as never)

    const first = client.mutateAsync({ n: 1 })
    await client.mutateAsync({ n: 2 })

    releaseFirst({ error: { type: 'TheoActionError', code: 'CONFLICT' }, data: undefined })
    await expect(first).rejects.toThrow()

    expect(client.getSnapshot().status).toBe('success')
    expect(client.getSnapshot().data).toBe('second')
  })

  it('discards an in-flight call when reset runs before it settles', async () => {
    let release: (v: unknown) => void = () => {}
    const client = new ActionClient(vi.fn(() => new Promise((r) => (release = r))) as never)

    const inFlight = client.mutateAsync({})
    client.reset()
    expect(client.getSnapshot().status).toBe('idle')

    release({ data: 'late', error: undefined })
    await inFlight

    expect(client.getSnapshot().status).toBe('idle')
    expect(client.getSnapshot().data).toBeUndefined()
  })
})

describe('ActionClient — the useSyncExternalStore contract', () => {
  it('serves the same snapshot reference until the state actually changes', () => {
    const client = new ActionClient(envelopeAction({ data: 1 }))

    // React re-renders forever when getSnapshot allocates on every call.
    expect(client.getSnapshot()).toBe(client.getSnapshot())
  })

  it('notifies subscribers on each transition and stops after unsubscribe', async () => {
    const client = new ActionClient(envelopeAction({ data: 'ok' }))
    const listener = vi.fn()

    const unsubscribe = client.subscribe(listener)
    await client.mutateAsync({})
    const whileSubscribed = listener.mock.calls.length
    expect(whileSubscribed).toBeGreaterThanOrEqual(2) // pending, then success

    unsubscribe()
    await client.mutateAsync({})
    expect(listener).toHaveBeenCalledTimes(whileSubscribed)
  })
})
