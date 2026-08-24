import { route } from 'theokit/server'

export const GET = route()
  .policy('public')
  .handler(() => ({ ok: true }))
  .build()
