import { action } from 'theokit/server'
import { z } from 'zod'

export const createUser = action()
  .input(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  )
  .handler(({ input }) => ({
    id: '1',
    name: input.name,
    email: input.email,
  }))
  .build()
