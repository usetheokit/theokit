import { route } from 'theokit/server'

export const GET = route()
  .handler(() => ({ ok: true }))
  .build()
