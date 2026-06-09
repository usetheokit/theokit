import { defineRoute } from 'theokit/server'

export const GET = defineRoute({
  handler: () => {
    return { total: 3, done: 0, pending: 3 }
  },
})
