import { route } from 'theokit/server'

export const GET = route()
  .handler(() => ({
    now: new Date(),
    label: 'with superjson, Date round-trips natively',
  }))
  .build()
