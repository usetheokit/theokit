import { z } from 'zod'

/**
 * CreateTaskDto — validates the request body for POST /tasks.
 *
 * Uses the TheoKit Pattern D2 convention: Zod schema attached via
 * `static schema` on the DTO class. The bridge reads this schema
 * at metadata-walk time and validates incoming requests automatically.
 *
 * This keeps Zod as the Single Source of Truth (per type-safety.md):
 *   - Runtime validation: from this schema
 *   - TypeScript types: via z.infer<typeof zCreateTask>
 *   - OpenAPI generation: from the same schema (via G2)
 */
export const zCreateTask = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must be at most 100 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

export class CreateTaskDto {
  static schema = zCreateTask
}

export type CreateTask = z.infer<typeof zCreateTask>
