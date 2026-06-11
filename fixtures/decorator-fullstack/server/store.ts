const tasks: { id: number; title: string; priority: string; done: boolean }[] = [
  { id: 1, title: 'Test task', priority: 'medium', done: false },
]
let nextId = 2

export const taskStore = {
  list: () => [...tasks],
  get: (id: number) => tasks.find(t => t.id === id),
  search: (q: string) => tasks.filter(t => t.title.includes(q)),
  create: (d: { title: string; priority?: string }) => {
    const t = { id: nextId++, title: d.title, priority: d.priority ?? 'medium', done: false }
    tasks.push(t)
    return t
  },
  update: (id: number, d: { done?: boolean }) => {
    const t = tasks.find(t => t.id === id)
    if (t && d.done !== undefined) t.done = d.done
    return t
  },
  remove: (id: number) => {
    const i = tasks.findIndex(t => t.id === id)
    if (i >= 0) tasks.splice(i, 1)
  },
}
