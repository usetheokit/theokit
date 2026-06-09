import { z } from 'zod'

export const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

export class CreateTaskDto {
  static schema = zCreateTask
}

export type CreateTask = z.infer<typeof zCreateTask>
