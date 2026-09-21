import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { composeComponentTree, type RouteTree } from '../../src/component-tree.js'

// Helper: simple functional components for testing
function TestLayout({ children }: { children: React.ReactNode }) {
  return React.createElement('div', { 'data-testid': 'layout' }, children)
}

function TestPage() {
  return React.createElement('p', null, 'Hello Page')
}

function TestLoading() {
  return React.createElement('span', null, 'Loading...')
}

function TestError() {
  return React.createElement('span', null, 'Something went wrong')
}

function TestNotFound() {
  return React.createElement('span', null, 'Not Found')
}

describe('Component Tree Composition', () => {
  it('test_compose_layout_wraps_page', async () => {
    // Given: a tree with layout and page
    const tree: RouteTree = {
      layout: TestLayout,
      page: TestPage,
    }

    // When: composed
    const element = await composeComponentTree(tree)

    // Then: layout wraps page
    expect(element).not.toBeNull()
    const html = renderToString(element!)
    expect(html).toContain('data-testid="layout"')
    expect(html).toContain('Hello Page')
  })

  it('test_compose_page_without_layout', async () => {
    // Given: a tree with only a page (no layout)
    const tree: RouteTree = {
      page: TestPage,
    }

    // When: composed
    const element = await composeComponentTree(tree)

    // Then: page rendered without layout wrapper
    expect(element).not.toBeNull()
    const html = renderToString(element!)
    expect(html).toContain('Hello Page')
    expect(html).not.toContain('data-testid="layout"')
  })

  it('test_compose_loading_adds_suspense', async () => {
    // Given: a tree with page and loading
    const tree: RouteTree = {
      page: TestPage,
      loading: TestLoading,
    }

    // When: composed
    const element = await composeComponentTree(tree)

    // Then: element is wrapped in Suspense (renderToString renders the children, not fallback)
    expect(element).not.toBeNull()
    const html = renderToString(element!)
    // Suspense renders children synchronously in SSR with renderToString
    expect(html).toContain('Hello Page')
  })

  it('test_a_caught_render_error_is_reported_with_a_digest', async () => {
    // B-217. `getDerivedStateFromError` declared no parameter, so the error React passed was
    // dropped: no stack, no message, no digest, no counter. The operator saw a page served
    // successfully — the swallowed-exception shape `rules/error-handling.md` names, in the only
    // place this package catches a render error, while the same package ships `error-digest.ts`
    // "suitable for logging" with an `ErrorContext` phase vocabulary ready for it.
    //
    // WHY THIS DRIVES THE METHOD DIRECTLY. React does not call `componentDidCatch` during server
    // rendering. Measured 2026-09-21, three shapes: a throw in the shell under `renderToString`
    // (which threw instead), the same under `renderToReadableStream` (also threw), and a `lazy`
    // rejecting inside `Suspense` after the shell (streamed the fallback, never reached it). The
    // server defers the error to the client, which is where a boundary runs — and this package has
    // no browser environment, so no render here can make React invoke it.
    const reported: { digest: unknown; info: unknown }[] = []

    const element = await composeComponentTree(
      { page: TestPage, error: TestError },
      {
        onError: (digest, info) => {
          reported.push({ digest, info })
        },
      },
    )

    const Boundary = element!.type as unknown as new (props: unknown) => {
      componentDidCatch?: (error: unknown, info: unknown) => void
    }
    const instance = new Boundary({ children: null })

    expect(
      typeof instance.componentDidCatch,
      'the boundary implements no componentDidCatch, so a caught error has nowhere to go',
    ).toBe('function')

    instance.componentDidCatch?.(new Error('a page component threw'), { componentStack: '\n at X' })

    expect(reported.length, 'the caught error was reported nowhere').toBe(1)
    const digest = reported[0].digest as {
      message: string
      digest: string
      context: Record<string, unknown>
    }
    expect(digest.message).toContain('a page component threw')
    // The phase vocabulary the package already had, so an operator reading a digest can tell this
    // apart from a controller that never came into existence.
    expect(digest.context.phase).toBe('handler')
    expect(digest.context.source).toBe('component-tree')
    expect(digest.digest).toMatch(/^[0-9a-f]+$/)
  })

  it('test_compose_error_adds_boundary', async () => {
    // Given: a tree with page and error component
    const tree: RouteTree = {
      page: TestPage,
      error: TestError,
    }

    // When: composed
    const element = await composeComponentTree(tree)

    // Then: renders successfully (error boundary wraps page, shows page when no error)
    expect(element).not.toBeNull()
    const html = renderToString(element!)
    expect(html).toContain('Hello Page')
  })

  it('test_compose_full_tree', async () => {
    // Given: a tree with all conventions
    const tree: RouteTree = {
      layout: TestLayout,
      page: TestPage,
      loading: TestLoading,
      error: TestError,
      notFound: TestNotFound,
    }

    // When: composed
    const element = await composeComponentTree(tree)

    // Then: all wrappers applied, page is innermost
    expect(element).not.toBeNull()
    const html = renderToString(element!)
    expect(html).toContain('data-testid="layout"')
    expect(html).toContain('Hello Page')
  })

  it('test_compose_empty_tree_returns_null', async () => {
    // Given: a tree with no page
    const tree: RouteTree = {
      layout: TestLayout,
      loading: TestLoading,
    }

    // When: composed
    const element = await composeComponentTree(tree)

    // Then: null returned
    expect(element).toBeNull()
  })
})
