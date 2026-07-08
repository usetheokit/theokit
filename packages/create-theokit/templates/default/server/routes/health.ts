import { route } from 'theokit/server/define'

export const GET = route()
  .handler(() => ({
    status: 'ok',
    timestamp: Date.now(),
    framework: 'TheoKit',
  }))
  .build()
