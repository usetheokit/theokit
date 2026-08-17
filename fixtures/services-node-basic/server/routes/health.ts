import { route } from 'theokit/server'

export const GET = route()
  .handler(() => Response.json({ ok: true }))
  .build()
