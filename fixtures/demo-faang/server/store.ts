/**
 * In-memory store — projects + tasks.
 * Production app would use Drizzle + PostgreSQL.
 */

export interface Project {
  id: number
  name: string
  description: string
  createdAt: string
}

export interface Task {
  id: number
  projectId: number
  title: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'todo' | 'in-progress' | 'done'
  assignee?: string
  createdAt: string
}

let projectSeq = 0
let taskSeq = 0

const projects: Project[] = [
  { id: ++projectSeq, name: 'TheoKit v1.0', description: 'Ship the framework', createdAt: '2026-06-01' },
  { id: ++projectSeq, name: 'Documentation Site', description: 'docs.theokit.dev', createdAt: '2026-06-05' },
]

const tasks: Task[] = [
  { id: ++taskSeq, projectId: 1, title: 'Web Standards migration', priority: 'critical', status: 'done', assignee: 'paulo', createdAt: '2026-06-01' },
  { id: ++taskSeq, projectId: 1, title: 'Agent decorators', priority: 'high', status: 'done', assignee: 'paulo', createdAt: '2026-06-02' },
  { id: ++taskSeq, projectId: 1, title: 'Observability adapters', priority: 'high', status: 'done', createdAt: '2026-06-03' },
  { id: ++taskSeq, projectId: 1, title: 'Bun + Deno runtime support', priority: 'medium', status: 'done', createdAt: '2026-06-04' },
  { id: ++taskSeq, projectId: 1, title: 'FAANG demo', priority: 'critical', status: 'in-progress', assignee: 'paulo', createdAt: '2026-06-10' },
  { id: ++taskSeq, projectId: 2, title: 'Getting started guide', priority: 'high', status: 'todo', createdAt: '2026-06-10' },
  { id: ++taskSeq, projectId: 2, title: 'API reference generation', priority: 'medium', status: 'todo', createdAt: '2026-06-10' },
  { id: ++taskSeq, projectId: 2, title: 'Deploy to Vercel', priority: 'low', status: 'todo', createdAt: '2026-06-10' },
]

export const store = {
  // Projects
  listProjects: () => [...projects],
  getProject: (id: number) => projects.find((p) => p.id === id),
  createProject: (data: { name: string; description?: string }) => {
    const project: Project = { id: ++projectSeq, name: data.name, description: data.description ?? '', createdAt: new Date().toISOString().split('T')[0] }
    projects.push(project)
    return project
  },
  updateProject: (id: number, data: Partial<Pick<Project, 'name' | 'description'>>) => {
    const p = projects.find((x) => x.id === id)
    if (!p) return null
    if (data.name) p.name = data.name
    if (data.description) p.description = data.description
    return p
  },
  deleteProject: (id: number) => {
    const idx = projects.findIndex((p) => p.id === id)
    if (idx === -1) return false
    projects.splice(idx, 1)
    return true
  },

  // Tasks
  listTasks: (projectId?: number) => projectId ? tasks.filter((t) => t.projectId === projectId) : [...tasks],
  getTask: (id: number) => tasks.find((t) => t.id === id),
  searchTasks: (q: string) => tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())),
  createTask: (data: { projectId: number; title: string; priority?: Task['priority']; assignee?: string }) => {
    const task: Task = { id: ++taskSeq, projectId: data.projectId, title: data.title, priority: data.priority ?? 'medium', status: 'todo', assignee: data.assignee, createdAt: new Date().toISOString().split('T')[0] }
    tasks.push(task)
    return task
  },
  updateTask: (id: number, data: Partial<Pick<Task, 'title' | 'priority' | 'status' | 'assignee'>>) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return null
    if (data.title) t.title = data.title
    if (data.priority) t.priority = data.priority
    if (data.status) t.status = data.status
    if (data.assignee !== undefined) t.assignee = data.assignee
    return t
  },
  stats: () => ({
    totalProjects: projects.length,
    totalTasks: tasks.length,
    byStatus: { todo: tasks.filter((t) => t.status === 'todo').length, 'in-progress': tasks.filter((t) => t.status === 'in-progress').length, done: tasks.filter((t) => t.status === 'done').length },
    byPriority: { critical: tasks.filter((t) => t.priority === 'critical').length, high: tasks.filter((t) => t.priority === 'high').length, medium: tasks.filter((t) => t.priority === 'medium').length, low: tasks.filter((t) => t.priority === 'low').length },
  }),
}
