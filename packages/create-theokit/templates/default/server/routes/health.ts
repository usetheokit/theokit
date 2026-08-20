import { route } from 'theokit/server/define'

export const GET = route()
  // A liveness probe answers the same thing to everyone, so it is genuinely open.
  // Every route declares this; `'public'` is the decision, not the absence of one.
  .policy('public')
  .handler(() => ({
    status: 'ok',
    timestamp: Date.now(),
    framework: 'TheoKit',
  }))
  .build()
