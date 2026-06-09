/**
 * server/routes/tasks.ts — TheoKit file-based route (defineRoute style)
 *
 * Serves the task API using the factory-function pattern.
 * When httpDecoratorsPlugin is active, decorator controllers can
 * override or coexist with these routes.
 */
import { defineRoute } from 'theokit/server'

const tasks = [
  { id: 1, title: 'Learn TheoKit decorators', done: false, priority: 'high' },
  { id: 2, title: 'Build AI agent app', done: false, priority: 'high' },
  { id: 3, title: 'Ship to production', done: false, priority: 'medium' },
]

export const GET = defineRoute({
  handler: () => {
    return tasks
  },
})
