/**
 * Component tree composition — recursive wrapping of file-convention
 * components (layout, page, loading, error, not-found) into a React
 * element tree with Suspense and error boundaries.
 *
 * Inspired by Next.js `create-component-tree.tsx`.
 *
 * React is loaded via dynamic `import('react')` because it is an
 * optional peerDep of @theokit/http (EC-2).
 */

import type * as ReactTypes from 'react'

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
export async function composeComponentTree(
  tree: RouteTree,
): Promise<ReactTypes.ReactElement | null> {
  // Dynamic import — React is optional peerDep
  const React = await import('react')

  return composeNode(React, tree)
}

function composeNode(React: typeof ReactTypes, node: RouteTree): ReactTypes.ReactElement | null {
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
    const Boundary = createErrorBoundary(React, ErrorFallback)
    element = React.createElement(Boundary, null, element)
  }

  // Wrap with layout if it exists
  if (Layout) {
    element = React.createElement(Layout, null, element)
  }

  return element
}
