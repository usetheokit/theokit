export class TaskService {
  private tasks = [
    { id: 1, title: 'Learn TheoKit decorators', done: false, priority: 'high' },
    { id: 2, title: 'Build AI agent app', done: false, priority: 'high' },
    { id: 3, title: 'Ship to production', done: false, priority: 'medium' },
  ]
  private nextId = 4

  findAll() { return this.tasks }
  findById(id: string) { return this.tasks.find(t => t.id === Number(id)) ?? null }
  search(q: string) { return this.tasks.filter(t => t.title.toLowerCase().includes((q ?? '').toLowerCase())) }
  create(data: { title: string; priority?: string }) {
    const task = { id: this.nextId++, title: data.title, done: false, priority: data.priority ?? 'medium' }
    this.tasks.push(task)
    return task
  }
  complete(id: string) {
    const task = this.tasks.find(t => t.id === Number(id))
    if (task) task.done = true
    return task
  }
  remove(id: string) {
    const idx = this.tasks.findIndex(t => t.id === Number(id))
    if (idx !== -1) this.tasks.splice(idx, 1)
  }
  stats() {
    return {
      total: this.tasks.length,
      done: this.tasks.filter(t => t.done).length,
      pending: this.tasks.filter(t => !t.done).length,
    }
  }
}
