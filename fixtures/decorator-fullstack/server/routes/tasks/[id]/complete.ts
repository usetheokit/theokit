import { defineRoute } from 'theokit/server'
import { z } from 'zod'
import { taskStore } from '../_store.js'

export const POST = defineRoute({
  params: z.object({ id: z.string() }),
  handler: ({ params }) => {
    const task = taskStore.complete(params.id)
    return task ?? { error: 'Task not found' }
  },
})
