import { describe, it, expect } from 'vitest'
import {
  getRequestContext,
  tryGetRequestContext,
  runWithRequestContext,
} from '../../src/request-context.js'

describe('Request Context (AsyncLocalStorage)', () => {
  it('test_get_context_outside_request_throws', () => {
    expect(() => getRequestContext()).toThrow('called outside a request')
  })

  it('test_try_get_context_outside_request_returns_null', () => {
    expect(tryGetRequestContext()).toBeNull()
  })

  it('test_context_available_inside_run', async () => {
    const ctx = {
      request: new Request('http://localhost:3000/api/tasks'),
      pathname: '/api/tasks',
      method: 'GET',
      params: {},
      startedAt: Date.now(),
    }

    await runWithRequestContext(ctx, () => {
      const result = getRequestContext()
      expect(result.pathname).toBe('/api/tasks')
      expect(result.method).toBe('GET')
      expect(result.request.url).toBe('http://localhost:3000/api/tasks')
    })
  })

  it('test_try_get_context_inside_run_returns_context', async () => {
    const ctx = {
      request: new Request('http://localhost:3000/'),
      pathname: '/',
      method: 'GET',
      params: {},
      startedAt: Date.now(),
    }

    await runWithRequestContext(ctx, () => {
      const result = tryGetRequestContext()
      expect(result).not.toBeNull()
      expect(result?.pathname).toBe('/')
    })
  })

  it('test_context_isolated_between_requests', async () => {
    const ctx1 = {
      request: new Request('http://localhost:3000/api/a'),
      pathname: '/api/a',
      method: 'GET',
      params: {},
      startedAt: Date.now(),
    }
    const ctx2 = {
      request: new Request('http://localhost:3000/api/b'),
      pathname: '/api/b',
      method: 'POST',
      params: {},
      startedAt: Date.now(),
    }

    await Promise.all([
      runWithRequestContext(ctx1, async () => {
        await new Promise((r) => setTimeout(r, 10))
        expect(getRequestContext().pathname).toBe('/api/a')
      }),
      runWithRequestContext(ctx2, async () => {
        await new Promise((r) => setTimeout(r, 5))
        expect(getRequestContext().pathname).toBe('/api/b')
      }),
    ])
  })

  it('test_context_not_leaked_after_run', async () => {
    const ctx = {
      request: new Request('http://localhost:3000/'),
      pathname: '/',
      method: 'GET',
      params: {},
      startedAt: Date.now(),
    }

    await runWithRequestContext(ctx, () => {
      expect(getRequestContext().pathname).toBe('/')
    })

    // After run completes, context should be gone
    expect(tryGetRequestContext()).toBeNull()
  })

  it('test_context_has_params', async () => {
    const ctx = {
      request: new Request('http://localhost:3000/api/tasks/42'),
      pathname: '/api/tasks/42',
      method: 'GET',
      params: { id: '42' },
      startedAt: Date.now(),
    }

    await runWithRequestContext(ctx, () => {
      expect(getRequestContext().params).toEqual({ id: '42' })
    })
  })

  it('test_context_has_handler_name', async () => {
    const ctx = {
      request: new Request('http://localhost:3000/api/tasks'),
      pathname: '/api/tasks',
      method: 'GET',
      params: {},
      handler: 'TasksController',
      startedAt: Date.now(),
    }

    await runWithRequestContext(ctx, () => {
      expect(getRequestContext().handler).toBe('TasksController')
    })
  })
})
