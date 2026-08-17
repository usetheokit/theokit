import { route } from 'theokit/server'

export const GET = route()
  .handler(({ ctx }) => {
    const started = (ctx as { startedAt?: number }).startedAt ?? 0
    return { ok: true, decoratedStartedAt: started }
  })
  .build()
