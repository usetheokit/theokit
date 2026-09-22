/**
 * Component tree composition — recursive wrapping of file-convention
 * components (layout, page, loading, error, not-found) into a React
 * element tree with Suspense and error boundaries.
 *
 * Builds the component tree the SSR renderer walks.
 *
 * React is loaded via dynamic `import('react')` because it is an
 * optional peerDep of @theokit/http (EC-2).
 */

import type * as ReactTypes from 'react'

import { digestError, type DigestedError } from './error-digest.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteTree {
  layout?: ReactTypes.ComponentType<{ children: ReactTypes.ReactNode }>
  page?: ReactTypes.ComponentType
  loading?: ReactTypes.ComponentType
  error?: ReactTypes.ComponentType
  notFound?: ReactTypes.ComponentType
  children?: Record<string, RouteTree>
}

// ---------------------------------------------------------------------------
// Error boundary — minimal class component wrapping error.tsx
// ---------------------------------------------------------------------------

/**
 * Creates an ErrorBoundary class component using the provided React module.
 * Must be a class component — React has no hook-based error boundary API.
 */
function createErrorBoundary(
  React: typeof ReactTypes,
  FallbackComponent: ReactTypes.ComponentType,
  report: ErrorBoundaryReporter,
): ReactTypes.ComponentType<{ children: ReactTypes.ReactNode }> {
  return class ErrorBoundary extends React.Component<
    { children: ReactTypes.ReactNode },
    { hasError: boolean }
  > {
    constructor(props: { children: ReactTypes.ReactNode }) {
      super(props)
      this.state = { hasError: false }
    }

    static getDerivedStateFromError(): { hasError: boolean } {
      return { hasError: true }
    }

    /**
     * B-217. `getDerivedStateFromError` declared no parameter, so the error React passed was
     * dropped: no stack, no message, no digest, no counter. The operator saw a page served
     * successfully. That is the swallowed-exception shape `rules/error-handling.md` names, in the
     * only place this package catches a render error — while the same package ships
     * `error-digest.ts` "suitable for logging", with an `ErrorContext` phase vocabulary ready.
     *
     * MEASURED 2026-09-21: React does NOT call this during server rendering. Three shapes were
     * tried — a throw in the shell under `renderToString`, the same under `renderToReadableStream`,
     * and a `lazy` rejecting inside `Suspense` after the shell — and none reached it. The server
     * streams the fallback and defers the error to the client, which is where a boundary runs. So
     * this reports where the failure is actually observed, and its test drives it directly because
     * no server-side render can.
     */
    componentDidCatch(error: unknown, info: ReactTypes.ErrorInfo): void {
      report(digestError(error, { phase: 'handler', source: 'component-tree' }), info)
    }

    render(): ReactTypes.ReactElement | null {
      if (this.state.hasError) {
        return React.createElement(FallbackComponent)
      }
      return React.createElement(React.Fragment, null, this.props.children)
    }
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Composes a {@link RouteTree} into a nested React element tree.
 *
 * Wrapping order (outermost → innermost):
 *   layout → ErrorBoundary(error) → Suspense(loading) → page
 *
 * Returns `null` when no `page` component is found in the tree.
 *
 * @param tree - The route tree describing file conventions found.
 * @returns A React element or `null`.
 */
/**
 * What an error boundary reports when it catches. B-217.
 *
 * Taken as a parameter rather than imported: this package does not own the consumer's logging, and
 * an injected reporter is what lets a test observe the report at all.
 */
export type ErrorBoundaryReporter = (digest: DigestedError, info: ReactTypes.ErrorInfo) => void

/** Where a caught render error goes when the caller names nowhere. Never silence. */
const defaultReporter: ErrorBoundaryReporter = (digest) => {
  console.error('[theokit] a page component threw and its error boundary caught it:', digest)
}

export async function composeComponentTree(
  tree: RouteTree,
  options: { onError?: ErrorBoundaryReporter } = {},
): Promise<ReactTypes.ReactElement | null> {
  // Dynamic import — React is optional peerDep
  const React = await import('react')

  return composeNode(React, tree, options.onError ?? defaultReporter)
}

function composeNode(
  React: typeof ReactTypes,
  node: RouteTree,
  report: ErrorBoundaryReporter,
): ReactTypes.ReactElement | null {
  const { layout: Layout, page: Page, loading: Loading, error: ErrorFallback } = node

  // No page → nothing to render
  if (!Page) {
    return null
  }

  // Start with the page element
  let element: ReactTypes.ReactElement = React.createElement(Page)

  // Wrap with Suspense if loading component exists
  if (Loading) {
    element = React.createElement(
      React.Suspense,
      { fallback: React.createElement(Loading) },
      element,
    )
  }

  // Wrap with error boundary if error component exists
  if (ErrorFallback) {
    const Boundary = createErrorBoundary(React, ErrorFallback, report)
    element = React.createElement(Boundary, null, element)
  }

  // Wrap with layout if it exists
  if (Layout) {
    element = React.createElement(Layout, null, element)
  }

  return element
}
