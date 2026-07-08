import { route } from 'theokit/server'

export const GET = route()
  .handler(({ ctx }: { ctx: any }) => ({
    requestId: ctx.requestId,
    middlewareRan: ctx.middlewareRan,
  }))
  .build()
