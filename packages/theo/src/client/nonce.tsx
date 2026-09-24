/**
 * The request's CSP nonce, readable from an application component.
 *
 * The node SSR target mints a nonce per request and stamps it onto the scripts the framework itself
 * emits. Anything an application inlines carries none, so the browser refuses it — which is what
 * `useNonce()` exists to fix.
 *
 * The value travels through a React context rather than a module-level variable: `renderToPipeableStream`
 * renders concurrently, and a module variable is shared across requests in one process, so request A's
 * nonce would reach request B's markup. It is deliberately NOT serialised into the hydration data
 * either — a nonce readable from the page is a nonce an attacker can copy onto an injected tag.
 *
 * That last decision has a consequence the consumer must handle: the value is a string on the server
 * and `undefined` on the client, so react-dom reports a hydration mismatch on the attribute.
 * `suppressHydrationWarning` on the element is the answer. See `docs/surfaces/csp-nonce.md`.
 */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/** Undefined by default: a target that mints no nonce is a supported state, not an error. */
export const NonceContext = createContext<string | undefined>(undefined)

export function NonceProvider(
  props: Readonly<{
    nonce: string | undefined
    children: ReactNode
  }>,
): React.JSX.Element {
  return <NonceContext.Provider value={props.nonce}>{props.children}</NonceContext.Provider>
}

/**
 * The request's nonce during SSR; `undefined` in the browser and on any target that mints none.
 *
 * ```tsx
 * const nonce = useNonce()
 * return <script nonce={nonce} suppressHydrationWarning>{`/* ... *\/`}</script>
 * ```
 */
export function useNonce(): string | undefined {
  return useContext(NonceContext)
}
