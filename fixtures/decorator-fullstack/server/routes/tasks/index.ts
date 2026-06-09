import { defineRoute } from 'theokit/server'
import { z } from 'zod'
import { taskStore } from './_store.js'

export const GET = defineRoute({
  handler: () => taskStore.findAll(),
})

export const POST = defineRoute({
  body: z.object({
    title: z.string().min(3, 'Title must be at least 3 characters'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  handler: ({ body }) => taskStore.create(body),
})
