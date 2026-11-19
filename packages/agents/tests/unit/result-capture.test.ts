import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ConfigurationError, NoResultSubmittedError, createResultCapture } from '../../src/index.js'

const schema = z.object({ title: z.string(), items: z.array(z.object({ body: z.string() })) })
const call = async (tool: { handler: unknown }, input: unknown) =>
  (tool.handler as (i: unknown) => unknown)(input)

describe('createResultCapture', () => {
  it('a valid submission is returned typed by result()', async () => {
    const cap = createResultCapture(schema)
    await call(cap.tool, { title: 't', items: [{ body: 'b' }] })
    const r: { title: string } = cap.result()
    expect(r.title).toBe('t')
    expect(cap.submitted()).toBe(true)
  })

  it('an invalid submission throws inside the handler with the zod issue paths in the message', async () => {
    const cap = createResultCapture(schema)
    await expect(call(cap.tool, { title: 't', items: [{}] })).rejects.toThrow(/items\.0\.body/)
    expect(cap.submitted()).toBe(false)
  })

  it('result() throws NoResultSubmittedError when the tool was never called', async () => {
    const cap = createResultCapture(schema, { name: 'report' })
    await expect(call(cap.tool, {})).rejects.toThrow()
    expect(() => cap.result()).toThrow(NoResultSubmittedError)
    try {
      cap.result()
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(NoResultSubmittedError)
      expect((e as Error).message).toContain('"report"')
      expect((e as Error).message).toContain('1 rejected')
      expect((e as NoResultSubmittedError).code).toBe('no_result_submitted')
    }
  })

  it('a never-called capture reports zero rejections', async () => {
    const cap = createResultCapture(schema)
    expect(cap.submitted()).toBe(false)
    expect(() => cap.result()).toThrow(/"submit_result".*\(0 rejected\)/)
  })

  it('advertises the input representation the handler validates', async () => {
    const cap = createResultCapture(z.object({ n: z.string().pipe(z.coerce.number()) }))
    const props = cap.tool.inputSchema.properties as Record<string, { type: string }>
    expect(props.n?.type).toBe('string')
    await call(cap.tool, { n: '5' })
    expect(cap.result()).toEqual({ n: 5 })
  })

  it('a later valid submission replaces an earlier one, and an invalid one keeps it', async () => {
    const cap = createResultCapture(schema)
    await call(cap.tool, { title: 'a', items: [] })
    await call(cap.tool, { title: 'b', items: [] })
    await expect(call(cap.tool, { title: 1 })).rejects.toThrow()
    expect(cap.result().title).toBe('b')
  })

  it('the tool inputSchema is type object', async () => {
    const cap = createResultCapture(schema)
    expect(cap.tool.inputSchema.type).toBe('object')
    expect(cap.tool.name).toBe('submit_result')
    expect(() => createResultCapture(z.string())).toThrow(ConfigurationError)
  })

  it('validates with an async refinement: valid input submits, invalid reports the path', async () => {
    const cap = createResultCapture(
      z.object({ id: z.string().refine(async (v) => v !== 'bad', 'id taken') }),
    )
    await expect(call(cap.tool, { id: 'bad' })).rejects.toThrow(/id: id taken/)
    expect(cap.submitted()).toBe(false)
    await call(cap.tool, { id: 'ok' })
    expect(cap.result()).toEqual({ id: 'ok' })
  })
})
