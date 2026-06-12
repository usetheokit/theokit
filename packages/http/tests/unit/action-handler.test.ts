import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createActionRegistry, handleAction } from '../../src/action-handler.js'

describe('Action Handler', () => {
  const UserSchema = z.object({
    name: z.string(),
    email: z.string(),
  })

  function makeRegistry() {
    const registry = createActionRegistry()
    registry.register({
      id: 'createUser',
      input: UserSchema,
      handler: async (input) => ({ id: '1', ...input }),
    })
    return registry
  }

  it('test_returns_null_when_no_action_header', async () => {
    // Given: a request without X-Theo-Action header
    const registry = makeRegistry()
    const request = new Request('http://localhost/', { method: 'POST' })

    // When: handleAction is called
    const result = await handleAction(registry, request)

    // Then: null is returned (fall through to controller pipeline)
    expect(result).toBeNull()
  })

  it('test_returns_404_when_action_not_found', async () => {
    // Given: a request with unknown action id
    const registry = makeRegistry()
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'X-Theo-Action': 'nonExistent' },
      body: JSON.stringify({}),
    })

    // When: handleAction is called
    const result = await handleAction(registry, request)

    // Then: 404 response with error details
    expect(result).not.toBeNull()
    expect(result!.status).toBe(404)
    const body = await result!.json()
    expect(body.error).toBe('Action not found')
    expect(body.actionId).toBe('nonExistent')
  })

  it('test_returns_400_when_malformed_json', async () => {
    // Given: a request with invalid JSON body (EC-5)
    const registry = makeRegistry()
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'X-Theo-Action': 'createUser',
        'Content-Type': 'application/json',
      },
      body: '{not valid json',
    })

    // When: handleAction is called
    const result = await handleAction(registry, request)

    // Then: 400 response for malformed JSON
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
    const body = await result!.json()
    expect(body.error).toBe('Malformed JSON body')
  })

  it('test_returns_400_when_validation_fails', async () => {
    // Given: a request with body that fails Zod validation
    const registry = makeRegistry()
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'X-Theo-Action': 'createUser' },
      body: JSON.stringify({ name: 'John', email: 'not-an-email' }),
    })

    // When: handleAction is called
    const result = await handleAction(registry, request)

    // Then: 400 response with validation issues
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
    const body = await result!.json()
    expect(body.error).toBe('Validation failed')
    expect(body.issues).toBeDefined()
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('test_returns_result_on_success', async () => {
    // Given: a valid action request
    const registry = makeRegistry()
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'X-Theo-Action': 'createUser' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    })

    // When: handleAction is called
    const result = await handleAction(registry, request)

    // Then: 200 response with handler result
    expect(result).not.toBeNull()
    expect(result!.status).toBe(200)
    const body = await result!.json()
    expect(body.result).toEqual({ id: '1', name: 'John', email: 'john@example.com' })
  })

  it('test_returns_500_when_handler_throws', async () => {
    // Given: an action whose handler throws
    const registry = createActionRegistry()
    registry.register({
      id: 'failAction',
      input: z.object({}),
      handler: async () => {
        throw new Error('Database connection lost')
      },
    })

    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'X-Theo-Action': 'failAction' },
      body: JSON.stringify({}),
    })

    // When: handleAction is called
    const result = await handleAction(registry, request)

    // Then: 500 response with error message
    expect(result).not.toBeNull()
    expect(result!.status).toBe(500)
    const body = await result!.json()
    expect(body.error).toBe('Database connection lost')
  })
})
