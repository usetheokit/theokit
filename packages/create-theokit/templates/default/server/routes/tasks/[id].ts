import { defineRoute } from 'theokit/server/define'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { tasks } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

export const GET = defineRoute({
  params: z.object({ id: z.coerce.number() }),
  handler: ({ params }) => {
    const task = db.select().from(tasks).where(eq(tasks.id, params.id)).get()
    if (!task) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })
    return task
  },
})

export const PUT = defineRoute({
  params: z.object({ id: z.coerce.number() }),
  body: z.object({
    title: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    done: z.boolean().optional(),
  }),
  handler: ({ params, body }) => {
    const result = db.update(tasks).set(body).where(eq(tasks.id, params.id)).returning().get()
    if (!result) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })
    return result
  },
})

export const DELETE = defineRoute({
  params: z.object({ id: z.coerce.number() }),
  status: 204,
  handler: ({ params }) => {
    db.delete(tasks).where(eq(tasks.id, params.id)).run()
  },
})
