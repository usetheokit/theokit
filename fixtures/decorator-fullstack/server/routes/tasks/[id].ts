import { defineRoute } from 'theokit/server'
import { z } from 'zod'
import { taskStore } from './_store.js'

export const GET = defineRoute({
  params: z.object({ id: z.string() }),
  handler: ({ params }) => {
    const task = taskStore.findById(params.id)
    return task ?? { error: 'Task not found' }
  },
})

export const DELETE = defineRoute({
  params: z.object({ id: z.string() }),
  status: 204,
  handler: ({ params }) => {
    taskStore.remove(params.id)
  },
})
