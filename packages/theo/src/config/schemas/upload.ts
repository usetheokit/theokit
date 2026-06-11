import { z } from 'zod'

export const uploadSchema = z.object({
  maxFileSize: z
    .number()
    .min(1)
    .default(10 * 1024 * 1024), // 10MB
  maxFiles: z.number().int().min(1).default(10),
  maxFieldSize: z
    .number()
    .min(1)
    .default(1 * 1024 * 1024), // 1MB
})
