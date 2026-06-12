import { defineRoute } from 'theokit/server/define'

export const GET = defineRoute({
  handler: () => ({
    status: 'ok',
    timestamp: Date.now(),
    framework: 'TheoKit',
  }),
})
