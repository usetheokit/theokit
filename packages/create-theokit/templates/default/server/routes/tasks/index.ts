import { defineRoute } from 'theokit/server/define'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { tasks } from '../../db/schema.js'

export const GET = defineRoute({
  handler: () => db.select().from(tasks).all(),
})

export const POST = defineRoute({
  body: z.object({
    title: z.string().min(3, 'Title must be at least 3 characters'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  status: 201,
  handler: ({ body }) => {
    const result = db.insert(tasks).values(body).returning().get()
    return result
  },
})
