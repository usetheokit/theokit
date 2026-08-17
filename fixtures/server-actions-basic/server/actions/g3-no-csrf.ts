import { action } from 'theokit/server'
import { z } from 'zod'

// Scenario 4 — csrf:false. Public endpoint callable without the X-Theo-Action
// header (e.g. an inbound webhook). The multi-header CSRF gate is bypassed.
export const publicEcho = action()
  .csrf(false)
  .input(z.object({ msg: z.string() }))
  .handler(({ input }) => ({ echoed: input.msg }))
  .build()
