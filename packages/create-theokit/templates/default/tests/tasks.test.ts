import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Schema mirrors server/routes/tasks/index.ts POST body validation.
// Unit test — no server dependency.
const taskBodySchema = z.object({
  title: z.string().min(3),
  done: z.boolean().default(false),
})

describe('Task body validation', () => {
  it('accepts valid task', () => {
    const result = taskBodySchema.safeParse({ title: 'Buy groceries' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Buy groceries')
      expect(result.data.done).toBe(false)
    }
  })

  it('defaults done to false', () => {
    const result = taskBodySchema.safeParse({ title: 'New task' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.done).toBe(false)
  })

  it('rejects title shorter than 3 characters', () => {
    expect(taskBodySchema.safeParse({ title: 'ab' }).success).toBe(false)
  })

  it('rejects empty title', () => {
    expect(taskBodySchema.safeParse({ title: '' }).success).toBe(false)
  })

  it('rejects missing title', () => {
    expect(taskBodySchema.safeParse({ done: true }).success).toBe(false)
  })
})
