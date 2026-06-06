import { z } from 'zod'

export const loggingSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
})
