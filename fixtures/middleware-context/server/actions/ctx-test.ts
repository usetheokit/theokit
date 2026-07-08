import { action } from 'theokit/server'
import { z } from 'zod'

export const testAction = action()
  .input(z.object({ value: z.string() }))
  .handler(({ input, ctx }: { input: any; ctx: any }) => ({
    value: input.value,
    requestId: ctx.requestId,
    middlewareRan: ctx.middlewareRan,
  }))
  .build()
