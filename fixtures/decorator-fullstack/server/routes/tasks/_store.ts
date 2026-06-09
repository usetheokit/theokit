/**
 * Shared task store — singleton across all route files.
 * In production this would be @theokit/orm Repository.
 */
interface Task {
  id: number
  title: string
  done: boolean
  priority: string
}

const tasks: Task[] = [
  { id: 1, title: 'Learn TheoKit decorators', done: false, priority: 'high' },
  { id: 2, title: 'Build AI agent app', done: false, priority: 'high' },
  { id: 3, title: 'Ship to production', done: false, priority: 'medium' },
]
let nextId = 4

export const taskStore = {
  findAll: () => tasks,
  findById: (id: string) => tasks.find(t => t.id === Number(id)) ?? null,
  create: (data: { title: string; priority?: string }) => {
    const task: Task = { id: nextId++, title: data.title, done: false, priority: data.priority ?? 'medium' }
    tasks.push(task)
    return task
  },
  complete: (id: string) => {
    const task = tasks.find(t => t.id === Number(id))
    if (task) task.done = true
    return task
  },
  remove: (id: string) => {
    const idx = tasks.findIndex(t => t.id === Number(id))
    if (idx !== -1) tasks.splice(idx, 1)
  },
  stats: () => ({
    total: tasks.length,
    done: tasks.filter(t => t.done).length,
    pending: tasks.filter(t => !t.done).length,
  }),
}
