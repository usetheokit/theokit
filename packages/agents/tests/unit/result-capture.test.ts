import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ConfigurationError, NoResultSubmittedError, createResultCapture } from '../../src/index.js'

const schema = z.object({ title: z.string(), items: z.array(z.object({ body: z.string() })) })
const call = (tool: { handler: unknown }, input: unknown) =>
  (tool.handler as (i: unknown) => unknown)(input)

describe('createResultCapture', () => {
  it('a valid submission is returned typed by result()', () => {
    const cap = createResultCapture(schema)
    call(cap.tool, { title: 't', items: [{ body: 'b' }] })
    const r: { title: string } = cap.result()
    expect(r.title).toBe('t')
    expect(cap.submitted()).toBe(true)
  })

  it('an invalid submission throws inside the handler with the zod issue paths in the message', () => {
    const cap = createResultCapture(schema)
    expect(() => call(cap.tool, { title: 't', items: [{}] })).toThrow(/items\.0\.body/)
    expect(cap.submitted()).toBe(false)
  })

  it('result() throws NoResultSubmittedError when the tool was never called', () => {
    const cap = createResultCapture(schema, { name: 'report' })
    expect(() => call(cap.tool, {})).toThrow()
    try {
      cap.result()
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(NoResultSubmittedError)
      expect((e as Error).message).toContain('"report"')
      expect((e as Error).message).toContain('1 invalid')
      expect((e as NoResultSubmittedError).code).toBe('no_result_submitted')
    }
  })

  it('a later valid submission replaces an earlier one, and an invalid one keeps it', () => {
    const cap = createResultCapture(schema)
    call(cap.tool, { title: 'a', items: [] })
    call(cap.tool, { title: 'b', items: [] })
    expect(() => call(cap.tool, { title: 1 })).toThrow()
    expect(cap.result().title).toBe('b')
  })

  it('the tool inputSchema is type object', () => {
    const cap = createResultCapture(schema)
    expect(cap.tool.inputSchema.type).toBe('object')
    expect(cap.tool.name).toBe('submit_result')
    expect(() => createResultCapture(z.string())).toThrow(ConfigurationError)
  })
})
