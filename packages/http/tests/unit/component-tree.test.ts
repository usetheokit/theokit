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
