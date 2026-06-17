/**
 * In-memory data store.
 * Replace with Drizzle + PostgreSQL for production.
 */

export interface Task {
  id: number
  title: string
  priority: 'low' | 'medium' | 'high'
  done: boolean
  createdAt: string
}

let seq = 0

const tasks: Task[] = [
  {
    id: ++seq,
    title: 'Set up TheoKit project',
    priority: 'high',
    done: true,
    createdAt: '2026-01-01',
  },
  {
    id: ++seq,
    title: 'Create first controller',
    priority: 'high',
    done: true,
    createdAt: '2026-01-02',
  },
  { id: ++seq, title: 'Add AI agent', priority: 'medium', done: false, createdAt: '2026-01-03' },
  {
    id: ++seq,
    title: 'Deploy to production',
    priority: 'low',
    done: false,
    createdAt: '2026-01-04',
  },
]

export const taskStore = {
  list: () => [...tasks],
  get: (id: number) => tasks.find((t) => t.id === id),
  search: (q: string) => tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())),
  create: (data: { title: string; priority?: Task['priority'] }) => {
    const task: Task = {
      id: ++seq,
      title: data.title,
      priority: data.priority ?? 'medium',
      done: false,
      createdAt: new Date().toISOString().split('T')[0],
    }
    tasks.push(task)
    return task
  },
  update: (id: number, data: Partial<Pick<Task, 'title' | 'priority' | 'done'>>) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return null
    if (data.title !== undefined) t.title = data.title
    if (data.priority !== undefined) t.priority = data.priority
    if (data.done !== undefined) t.done = data.done
    return t
  },
  remove: (id: number) => {
    const idx = tasks.findIndex((t) => t.id === id)
    if (idx === -1) return false
    tasks.splice(idx, 1)
    return true
  },
}
