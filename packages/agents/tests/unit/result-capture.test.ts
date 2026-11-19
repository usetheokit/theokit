import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ConfigurationError, createResultCapture, NoResultSubmittedError } from '../../src/index.js'

const schema = z.object({ title: z.string(), count: z.number() })
type Handler = (input: unknown, ctx?: unknown) => Promise<unknown>
const call = (cap: ReturnType<typeof createResultCapture>, input: unknown) =>
  (cap.tool as unknown as { handler: Handler }).handler(input, {})

describe('createResultCapture', () => {
  it('a valid submission is returned typed by result()', async () => {
    const cap = createResultCapture(schema)
    await call(cap, { title: 'a', count: 2 })
    const r: { title: string; count: number } = cap.result()
    expect(r).toEqual({ title: 'a', count: 2 })
    expect(cap.submitted()).toBe(true)
    expect(cap.tool.name).toBe('submit_result')
  })

  it('an invalid submission throws inside the handler with the zod issue paths in the message', async () => {
    const cap = createResultCapture(schema)
    await expect(call(cap, { title: 'a', count: 'x' })).rejects.toThrow(/count/)
    expect(cap.submitted()).toBe(false)
  })

  it('result() throws NoResultSubmittedError when the tool was never called', () => {
    const cap = createResultCapture(schema, { name: 'report' })
    expect(cap.submitted()).toBe(false)
    expect(() => cap.result()).toThrow(NoResultSubmittedError)
    expect(() => cap.result()).toThrow(/report/)
    expect(() => cap.result()).toThrow(/0 invalid/)
  })

  it('the error counts the invalid submissions that were rejected', async () => {
    const cap = createResultCapture(schema)
    await call(cap, {}).catch(() => undefined)
    expect(() => cap.result()).toThrow(/1 invalid submission /)
  })

  it('a later valid submission replaces an earlier one', async () => {
    const cap = createResultCapture(schema)
    await call(cap, { title: 'a', count: 1 })
    await call(cap, { title: 'b', count: 2 })
    await call(cap, { title: 'c' }).catch(() => undefined)
    expect(cap.result().title).toBe('b')
  })

  it('the tool inputSchema is type object', () => {
    const cap = createResultCapture(schema)
    expect((cap.tool as unknown as { inputSchema: { type: string } }).inputSchema.type).toBe(
      'object',
    )
    expect(() => createResultCapture(z.string())).toThrow(ConfigurationError)
  })
})
