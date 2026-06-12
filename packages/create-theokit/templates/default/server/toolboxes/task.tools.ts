/**
 * TaskTools — agent toolbox for task management.
 *
 * These tools are called by the LLM when the agent decides
 * to interact with the task data. Each @Tool method is
 * compiled to a defineTool() call at startup.
 */
import { z } from 'zod'
import { Toolbox, Tool, Trace, Audit } from '@theokit/agents'
import { taskStore } from '../store.js'

@Toolbox() // Convention: TaskTools → namespace: 'task'
@Trace(true)
export class TaskTools {
  @Tool({
    name: 'list',
    description: 'List all tasks with their status and priority',
    input: z.object({}),
  })
  async list() {
    return JSON.stringify(taskStore.list())
  }

  @Tool({
    name: 'search',
    description: 'Search tasks by keyword in title',
    input: z.object({ query: z.string() }),
  })
  async search(input: { query: string }) {
    return JSON.stringify(taskStore.search(input.query))
  }

  @Tool({
    name: 'create',
    description: 'Create a new task',
    input: z.object({
      title: z.string(),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
    }),
    risk: 'medium',
  })
  @Audit(true)
  async create(input: { title: string; priority?: 'low' | 'medium' | 'high' }) {
    return JSON.stringify(taskStore.create(input))
  }

  @Tool({
    name: 'complete',
    description: 'Mark a task as done by its ID',
    input: z.object({ taskId: z.number() }),
  })
  @Audit(true)
  async complete(input: { taskId: number }) {
    const task = taskStore.update(input.taskId, { done: true })
    return task ? JSON.stringify(task) : 'Task not found'
  }
}
