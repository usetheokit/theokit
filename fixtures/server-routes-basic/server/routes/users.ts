import { route } from 'theokit/server'
import { z } from 'zod'

export const GET = route()
  .query(z.object({ search: z.string().optional() }))
  .handler(({ query }) => ({ users: [], search: query.search }))
  .build()

export const POST = route()
  .body(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  )
  .status(201)
  .handler(({ body }) => ({ id: '1', name: body.name, email: body.email }))
  .build()
