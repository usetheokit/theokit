import { defineRoute } from 'theokit/server'
import { taskStore } from './_store.js'

export const GET = defineRoute({
  handler: () => taskStore.stats(),
})
