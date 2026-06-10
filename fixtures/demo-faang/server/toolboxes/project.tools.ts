import 'reflect-metadata'
import { z } from 'zod'
import { Toolbox, Tool, RequiresApproval, Trace, Audit } from '../../../../packages/agents/src/decorators/index.js'
import { store } from '../store.js'

@Toolbox({ namespace: 'project' })
@Trace(true)
export class ProjectTools {
  @Tool({
    name: 'list_projects',
    description: 'List all projects with their details',
    input: z.object({}),
  })
  async listProjects() {
    return JSON.stringify(store.listProjects())
  }

  @Tool({
    name: 'list_tasks',
    description: 'List tasks for a specific project, or all tasks if no projectId given',
    input: z.object({ projectId: z.number().optional() }),
  })
  async listTasks(input: { projectId?: number }) {
    return JSON.stringify(store.listTasks(input.projectId))
  }

  @Tool({
    name: 'get_stats',
    description: 'Get project/task statistics (counts by status and priority)',
    input: z.object({}),
  })
  async getStats() {
    return JSON.stringify(store.stats())
  }

  @Tool({
    name: 'search_tasks',
    description: 'Search tasks by title keyword',
    input: z.object({ query: z.string() }),
  })
  async searchTasks(input: { query: string }) {
    return JSON.stringify(store.searchTasks(input.query))
  }

  @Tool({
    name: 'create_task',
    description: 'Create a new task in a project',
    input: z.object({
      projectId: z.number(),
      title: z.string(),
      priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      assignee: z.string().optional(),
    }),
    risk: 'medium',
  })
  @RequiresApproval({ reason: 'Creates a new task in the project' })
  @Audit(true)
  async createTask(input: { projectId: number; title: string; priority?: 'low' | 'medium' | 'high' | 'critical'; assignee?: string }) {
    const task = store.createTask(input)
    return JSON.stringify(task)
  }

  @Tool({
    name: 'update_task_status',
    description: 'Update a task status (todo, in-progress, done)',
    input: z.object({
      taskId: z.number(),
      status: z.enum(['todo', 'in-progress', 'done']),
    }),
  })
  @Audit(true)
  async updateTaskStatus(input: { taskId: number; status: 'todo' | 'in-progress' | 'done' }) {
    const task = store.updateTask(input.taskId, { status: input.status })
    return task ? JSON.stringify(task) : 'Task not found'
  }

  @Tool({
    name: 'prioritize_tasks',
    description: 'Analyze and suggest priority changes for tasks in a project based on dependencies and deadlines',
    input: z.object({ projectId: z.number() }),
  })
  async prioritizeTasks(input: { projectId: number }) {
    const tasks = store.listTasks(input.projectId)
    const suggestions = tasks
      .filter((t) => t.status !== 'done')
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        currentPriority: t.priority,
        suggestedPriority: t.status === 'in-progress' ? 'high' : t.priority,
        reason: t.status === 'in-progress' ? 'In-progress tasks should be high priority' : 'No change needed',
      }))
    return JSON.stringify(suggestions)
  }
}
