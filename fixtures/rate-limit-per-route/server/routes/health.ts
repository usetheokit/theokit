import { route } from 'theokit/server'
import { z } from 'zod'

export const GET = route()
  .query(z.object({}))
  .handler(async () => {
    return { status: 'ok' }
  })
  .build()
