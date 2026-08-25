import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import type { ActionError } from '../core/contracts/action-protocol.js'

import { ActionClient, type ActionCallable } from './action-client.js'

/**
 * usetheokit/theokit#453 — call a server action from a component and track its state.
 *
 * The framework already generates the typed callable (`@theo/actions`), serves it at
 * `/api/__actions/`, and defines the error hierarchy it answers with. This is the last piece:
 *
 * ```tsx
 * import { actions } from '@theo/actions'
 * import { useAction } from 'theokit/client'
 *
 * function SaveButton() {
 *   const save = useAction(actions.saveMemory)
 *   return (
 *     <button disabled={save.isPending} onClick={() => save.mutate({ content: 'hi' })}>
 *       {save.isPending ? 'Saving…' : 'Save'}
 *     </button>
 *   )
 * }
 * ```
 *
 * A failure lands in `error` as the protocol's own {@link ActionError} — so a validation failure is
 * an `ActionInputError` with its `fields` map intact, which is what a form library binds to.
 *
 * The state machine lives in {@link ActionClient}; this is a `useSyncExternalStore` binding over it,
 * the same shape as `useAgent`.
 */
export interface UseActionResult<TInput = unknown, TData = unknown> {
  /** The data of the most recent successful call. */
  data: TData | undefined
  /** The typed error of the most recent failed call. */
  error: ActionError | undefined
  isIdle: boolean
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  /** The input of the most recent call — what a retry button replays. */
  variables: TInput | undefined
  /** Fire and forget; read the outcome off `isPending` / `error`. */
  mutate: (input: TInput) => void
  /** Await the data, or catch the typed {@link ActionError}. */
  mutateAsync: (input: TInput) => Promise<TData>
  /** Back to idle, discarding whatever is in flight. */
  reset: () => void
}

export function useAction<TInput = unknown, TData = unknown>(
  action: ActionCallable<TInput, TData>,
): UseActionResult<TInput, TData> {
  // The store is built once per mount and invokes through a ref, rather than being rebuilt when
  // `action` changes identity. The generated callables are cached per action and stable, but a
  // hand-written inline one is not — and rebuilding on it would silently drop the state a component
  // is mid-way through, which is the same reasoning `useAgent` records for its options ref.
  const actionRef = useRef(action)
  useEffect(() => {
    actionRef.current = action
  }, [action])

  const client = useMemo(
    () => new ActionClient<TInput, TData>((input) => actionRef.current(input)),
    [],
  )

  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

  return {
    data: state.data,
    error: state.error,
    isIdle: state.status === 'idle',
    isPending: state.status === 'pending',
    isError: state.status === 'error',
    isSuccess: state.status === 'success',
    variables: state.variables,
    mutate: client.mutate,
    mutateAsync: client.mutateAsync,
    reset: client.reset,
  }
}
