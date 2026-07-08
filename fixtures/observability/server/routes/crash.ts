import { route } from 'theokit/server'
export const GET = route()
  .handler(() => {
    throw new Error('Intentional crash for testing')
  })
  .build()
