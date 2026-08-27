import { ActionError, ActionInputError, isActionError } from '../core/contracts/action-protocol.js'

/**
 * usetheokit/theokit#453 — the framework-agnostic store behind {@link useAction}.
 *
 * `core/contracts/action-protocol.ts` opens by describing itself as the "cross-boundary contract
 * for `defineAction` + `useAction`" and points the client half at `@theokit/react/useAction` — a
 * package outside this repository, with one version, no `repository` field, and a
 * `@theokit/sdk ^1.1.0` peer against a published 4.x. The server half of that contract has always
 * lived here; this is the client half arriving.
 *
 * The state machine lives in a store rather than in the hook, following `useAgent`: it is testable
 * with no DOM, and a non-React surface can subscribe to it directly. The hook in `use-action.ts` is
 * a `useSyncExternalStore` binding over it.
 */

/**
 * What a generated callable resolves.
 *
 * Deliberately NOT `ActionResult`, whose `error` is an `ActionError` instance: the envelope crosses
 * the wire as JSON, so what arrives is a plain object, and a callable typed against the class would
 * be one no honest implementation can satisfy. `error` is `unknown` here and normalized on the way
 * into the state.
 *
 * Both keys are present — the generated facade always emits both — which is also what tells an
 * envelope apart from a payload that merely has a field named `data` or `error`.
 */
export interface ActionEnvelope<TData = unknown> {
  readonly data: TData | undefined
  readonly error: unknown
}

/**
 * A callable shaped like the ones `@theo/actions` generates. They resolve an
 * {@link ActionEnvelope} rather than throwing — including for network failure — but a hand-written
 * callable that resolves a bare value or throws is handled too, since consumers pass both.
 */
export type ActionCallable<TInput = unknown, TData = unknown> = (
  input: TInput,
) => Promise<ActionEnvelope<TData> | TData>

export type ActionStatus = 'idle' | 'pending' | 'error' | 'success'

/** The observable state, one frozen object per transition (`useSyncExternalStore` contract). */
export interface ActionState<TInput = unknown, TData = unknown> {
  readonly status: ActionStatus
  readonly data: TData | undefined
  readonly error: ActionError | undefined
  /** The input of the most recent call — what a retry button replays. */
  readonly variables: TInput | undefined
}

const IDLE: ActionState = Object.freeze({
  status: 'idle',
  data: undefined,
  error: undefined,
  variables: undefined,
})

/**
 * Normalize whatever the callable produced into the protocol's own error type.
 *
 * The wire carries JSON, not class instances, so the envelope's `error` arrives as a plain object;
 * `ActionError.fromJson` reconstructs the hierarchy — which is what gives a validation failure its
 * `fields` map back, the shape `@theokit/plugin-forms` bridges into react-hook-form.
 */
function toActionError(raw: unknown): ActionError {
  if (isActionError(raw)) return raw

  if (raw instanceof Error) {
    return new ActionError({
      code: 'INTERNAL_SERVER_ERROR',
      message: raw.message,
      stack: raw.stack,
    })
  }

  if (typeof raw !== 'object' || raw === null) {
    return new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: String(raw) })
  }

  const obj = raw as Record<string, unknown>
  if (obj.type === 'TheoActionInputError' || obj.type === 'TheoActionError') {
    if (obj.type === 'TheoActionInputError' && Array.isArray(obj.issues)) {
      return ActionError.fromJson(raw)
    }
    if (obj.type === 'TheoActionError') {
      return ActionError.fromJson(raw)
    }
  }

  // `ActionError.fromJson` reads `issues`, and the wire carries both it and the derived `fields`
  // (`server/http/serialize-action-result.ts`). An error that arrives with only the map has nothing
  // for `fromJson` to read, and falling through answers INTERNAL_SERVER_ERROR with the map gone —
  // `fields` being the entire reason a form library subscribes to this error.
  //
  // This used to be gated on `obj.type === 'TheoActionInputError'`, and that guard excluded the very
  // case it was written for. `type` is a WIRE marker set by the serializer; the shape that arrives
  // with only a map is the HAND-WRITTEN action, which has no reason to know the marker exists.
  // Measured through usetheokit/theokit-plugins#175: an action returning
  // `{ code, message, fields }` reached the form as an ActionError with no `fields`, the form's
  // duck-type found nothing to place, and it re-threw — an uncaught rejection and a user shown
  // nothing at all.
  //
  // Recognising the map without the marker is safe because `issuesFromFields` returns `undefined`
  // for anything that is not a field map. The shape that actually reaches the fallthrough —
  // `{code:'NETWORK_ERROR', message:'fetch failed'}` from the generated facade — carries no
  // `fields` and is unaffected, which its own test asserts.
  const rebuilt = issuesFromFields(obj.fields)
  if (rebuilt !== undefined) return new ActionInputError(rebuilt)

  // A shape the protocol does not define. The one that actually occurs is the generated facade's
  // `{code:'NETWORK_ERROR', message:'fetch failed'}` when `fetch` itself rejects: the code has no
  // ActionErrorCode to normalize to, and the message is then the only diagnostic there is — passing
  // it through `fromJson` would replace "fetch failed" with "INTERNAL_SERVER_ERROR".
  const message = typeof obj.message === 'string' ? obj.message : undefined
  return new ActionError({ code: 'INTERNAL_SERVER_ERROR', message })
}

/**
 * Invert `buildFieldsMap`: turn a `{ 'user.address.zip': ['Required'] }` map back into the issues it
 * was derived from, so `ActionInputError` can re-derive an identical map.
 *
 * The key convention is the protocol's (`core/contracts/action-protocol.ts`): dot-notation full
 * path, array indices as numeric segments (`items.0.name`), root as the empty string. Splitting on
 * `.` reverses all three — the empty key becoming `[]` rather than `['']` is the one that needs
 * saying, because `''.split('.')` returns `['']` and would key the rebuilt map on `'.'`-joined
 * nothing instead of on root.
 *
 * Returns `undefined` when the value is not a field map, so the caller falls through rather than
 * inventing a validation error out of an unrelated shape.
 */
function issuesFromFields(raw: unknown): { path: string[]; message: string }[] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined

  const issues: { path: string[]; message: string }[] = []
  for (const [key, messages] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(messages)) return undefined
    const path = key === '' ? [] : key.split('.')
    for (const message of messages) {
      if (typeof message !== 'string') return undefined
      issues.push({ path, message })
    }
  }
  return issues.length > 0 ? issues : undefined
}

/** Is this an `{data, error}` envelope, or a bare value the caller means as data? */
function isEnvelope(raw: unknown): raw is ActionEnvelope {
  return typeof raw === 'object' && raw !== null && 'data' in raw && 'error' in raw
}

/**
 * Holds `{status, data, error, variables}` for one action callable and notifies subscribers on each
 * transition.
 */
export class ActionClient<TInput = unknown, TData = unknown> {
  readonly #action: ActionCallable<TInput, TData>
  readonly #listeners = new Set<() => void>()
  #state: ActionState<TInput, TData> = IDLE as ActionState<TInput, TData>

  /**
   * Monotonic id of the newest call. Every state write checks it, so a response that arrives after
   * a newer call started is discarded rather than overwriting it — the ordering a slow network
   * produces on a form submitted twice, where the stale answer would otherwise win by arriving last.
   */
  #callId = 0

  constructor(action: ActionCallable<TInput, TData>) {
    this.#action = action
  }

  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * The current snapshot, stable by reference until the next transition. Allocating here instead
   * would re-render a React consumer forever.
   */
  getSnapshot = (): ActionState<TInput, TData> => this.#state

  /** Invoke the action, resolving its data or rejecting with a typed {@link ActionError}. */
  mutateAsync = async (input: TInput): Promise<TData> => {
    const callId = ++this.#callId
    this.#emit({ status: 'pending', data: undefined, error: undefined, variables: input })

    let raw: ActionEnvelope<TData> | TData
    try {
      raw = await this.#action(input)
    } catch (thrown) {
      const error = toActionError(thrown)
      if (callId === this.#callId) {
        this.#emit({ status: 'error', data: undefined, error, variables: input })
      }
      throw error
    }

    if (isEnvelope(raw) && raw.error !== undefined) {
      const error = toActionError(raw.error)
      if (callId === this.#callId) {
        this.#emit({ status: 'error', data: undefined, error, variables: input })
      }
      throw error
    }

    const data = (isEnvelope(raw) ? raw.data : raw) as TData
    if (callId === this.#callId) {
      this.#emit({ status: 'success', data, error: undefined, variables: input })
    }
    return data
  }

  /**
   * Fire-and-forget: the outcome lands in the state, and the returned promise is consumed here so a
   * failure does not surface as an unhandled rejection in a component that only reads `isError`.
   */
  mutate = (input: TInput): void => {
    void this.mutateAsync(input).catch(() => undefined)
  }

  /** Back to idle, discarding whatever is in flight. */
  reset = (): void => {
    this.#callId++
    this.#emit(IDLE as ActionState<TInput, TData>)
  }

  #emit(next: ActionState<TInput, TData>): void {
    this.#state = Object.freeze(next)
    for (const listener of this.#listeners) listener()
  }
}
