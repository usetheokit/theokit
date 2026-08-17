import { route } from 'theokit/server'

export const GET = route()
  .handler(() => ({ status: 'ok', target: process.env.THEO_TARGET ?? 'unknown' }))
  .build()
