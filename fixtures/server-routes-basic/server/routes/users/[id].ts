import { route } from 'theokit/server'
import { z } from 'zod'

export const GET = route()
  .params(z.object({ id: z.string() }))
  .handler(({ params }) => ({ id: params.id }))
  .build()
