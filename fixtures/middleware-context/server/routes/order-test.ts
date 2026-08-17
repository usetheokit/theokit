import { route } from 'theokit/server'

export const GET = route()
  .handler(({ ctx }: { ctx: any }) => ({
    hasRequestId: typeof ctx.requestId === 'string',
    middlewareRan: ctx.middlewareRan === true,
    handlerRan: true,
  }))
  .build()
