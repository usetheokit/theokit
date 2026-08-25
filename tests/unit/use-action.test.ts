/**
 * usetheokit/theokit#453 — the React binding over {@link ActionClient}.
 *
 * What this file can and cannot cover, stated rather than implied: this repository runs its unit
 * tests in Node with no DOM (`useAgent` is written against `useSyncExternalStore` for the same
 * reason), so the binding is exercised through `react-dom/server`. That reaches the first render
 * and the store wiring; it never mounts, so it never subscribes. The state machine those
 * subscriptions drive is covered directly in `action-client.test.ts`, which is where it lives.
 *
 * Written with `createElement` rather than JSX because the root vitest project includes
 * `tests/**\/*.test.ts` only — a `.tsx` file here would run nowhere, which is the failure
 * `tests/unit/vitest-projects-cover-every-test.test.ts` exists to catch.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

import { useAction, type UseActionResult } from '../../packages/theo/src/client/use-action.js'

/** Render the hook once and hand back what it returned. */
function renderHook<TInput, TData>(
  action: (input: TInput) => Promise<unknown>,
): UseActionResult<TInput, TData> {
  let captured: UseActionResult<TInput, TData> | undefined
  function Probe(): null {
    captured = useAction<TInput, TData>(action as never)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (captured === undefined) throw new Error('the probe never rendered')
  return captured
}

describe('useAction', () => {
  it('starts idle, with every flag agreeing on it', () => {
    const result = renderHook(vi.fn(async () => ({ data: 1, error: undefined })))

    expect(result.isIdle).toBe(true)
    expect(result.isPending).toBe(false)
    expect(result.isError).toBe(false)
    expect(result.isSuccess).toBe(false)
    expect(result.data).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.variables).toBeUndefined()
  })

  it('hands back callables bound to a store that actually runs the action', async () => {
    const action = vi.fn(async () => ({ data: 'saved', error: undefined }))
    const result = renderHook<{ id: string }, string>(action)

    await expect(result.mutateAsync({ id: 'a' })).resolves.toBe('saved')
    expect(action).toHaveBeenCalledWith({ id: 'a' })
  })

  it('exposes reset without requiring a call first', () => {
    const result = renderHook(vi.fn(async () => ({ data: 1, error: undefined })))

    expect(() => result.reset()).not.toThrow()
    expect(typeof result.mutate).toBe('function')
  })
})
