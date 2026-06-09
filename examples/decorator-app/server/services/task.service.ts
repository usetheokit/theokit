/**
 * TaskService — business logic for the tasks domain.
 *
 * Injected into TasksController via constructor DI:
 *   constructor(private taskService: TaskService) {}
 *
 * In production, this would use @theokit/orm Repository pattern.
 * For this example, data lives in-memory.
 */
export class TaskService {
  private tasks = [
    {
      id: 1,
      title: 'Learn TheoKit decorators',
      done: false,
      priority: 'high' as const,
      createdAt: new Date('2026-06-09'),
    },
    {
      id: 2,
      title: 'Build an AI agent app',
      done: false,
      priority: 'high' as const,
      createdAt: new Date('2026-06-09'),
    },
    {
      id: 3,
      title: 'Ship to production',
      done: false,
      priority: 'medium' as const,
      createdAt: new Date('2026-06-09'),
    },
    {
      id: 4,
      title: 'Write documentation',
      done: true,
      priority: 'low' as const,
      createdAt: new Date('2026-06-08'),
    },
  ]
  private nextId = 5

  findAll() {
    return this.tasks
  }

  findById(id: string) {
    return this.tasks.find((t) => t.id === Number(id)) ?? null
  }

  search(query: string) {
    const q = (query ?? '').toLowerCase()
    return this.tasks.filter((t) => t.title.toLowerCase().includes(q))
  }

  create(data: { title: string; priority?: 'low' | 'medium' | 'high' }) {
    const task = {
      id: this.nextId++,
      title: data.title,
      done: false,
      priority: data.priority ?? ('medium' as const),
      createdAt: new Date(),
    }
    this.tasks.push(task)
    return task
  }

  complete(id: string) {
    const task = this.tasks.find((t) => t.id === Number(id))
    if (!task) return null
    task.done = true
    return task
  }

  remove(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === Number(id))
    if (idx !== -1) this.tasks.splice(idx, 1)
    return idx !== -1
  }

  stats() {
    return {
      total: this.tasks.length,
      done: this.tasks.filter((t) => t.done).length,
      pending: this.tasks.filter((t) => !t.done).length,
      byPriority: {
        high: this.tasks.filter((t) => t.priority === 'high').length,
        medium: this.tasks.filter((t) => t.priority === 'medium').length,
        low: this.tasks.filter((t) => t.priority === 'low').length,
      },
    }
  }
}
