'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'

interface Task {
  id: number
  title: string
  priority: 'high' | 'medium' | 'low'
  done: boolean
}
type Role = '' | 'user' | 'admin'

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [role, setRole] = useState<Role>('user')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [formError, setFormError] = useState('')

  const hdrs = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (role) h['x-role'] = role
    return h
  }, [role])

  const loadTasks = useCallback(async () => {
    const res = await fetch('/api/tasks')
    if (res.ok) setTasks(await res.json())
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const createTask = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!title.trim()) return
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ title, priority }),
    })
    if (res.status === 403) {
      setFormError('403 — Need User role')
      return
    }
    if (!res.ok) {
      const b = await res.json()
      setFormError(b.error?.issues?.[0]?.message ?? `Error ${res.status}`)
      return
    }
    setTitle('')
    loadTasks()
  }

  return (
    <div className="page">
      <div className="main">
        {/* Hero */}
        <header className="hero">
          <img src="/logo.png" alt="TheoKit" width={72} height={72} className="hero-logo" />
          <h1>TheoKit</h1>
          <p className="tagline">Build the app your agent lives in.</p>
          <nav className="ctas">
            <a
              href="https://usetheo.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary"
            >
              Get Started
            </a>
            <a
              href="https://github.com/usetheodev/theokit"
              target="_blank"
              rel="noopener noreferrer"
              className="btn secondary"
            >
              Documentation
            </a>
          </nav>
          <p className="hint">
            Edit <code>app/page.tsx</code> to get started. Changes hot-reload instantly.
          </p>
        </header>

        {/* Role */}
        <div className="role-bar">
          <label htmlFor="role">Role:</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="">None (public)</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        {/* Tasks */}
        <section className="card">
          <h2>
            Tasks <span className="badge">@Controller</span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className={t.done ? 'done' : ''}>
                  <td>
                    {t.done ? '✅ ' : '○ '}
                    {t.title}
                  </td>
                  <td>
                    <span className={`prio prio-${t.priority}`}>{t.priority}</span>
                  </td>
                  <td>{t.done ? 'Done' : 'To do'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={createTask} className="create-bar">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New task..."
              required
              minLength={3}
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Task['priority'])}
            >
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
            <button type="submit">Add</button>
          </form>
          {formError && <p className="error">{formError}</p>}
        </section>

        {/* Features */}
        <div className="grid features">
          <div className="feature">
            <h3>@Controller</h3>
            <p>
              NestJS-style decorators with convention naming. <code>TasksController</code> →{' '}
              <code>/api/tasks</code>
            </p>
          </div>
          <div className="feature">
            <h3>defineRoute</h3>
            <p>
              Typed API routes with Zod validation. See <code>server/routes/health.ts</code>
            </p>
          </div>
          <div className="feature">
            <h3>@Agent + @Tool</h3>
            <p>AI agents with SSE streaming, budget control, and human-in-the-loop approval.</p>
          </div>
          <div className="feature">
            <h3>React + Vite</h3>
            <p>File-based routing, HMR, SSR streaming. Edit and see changes instantly.</p>
          </div>
        </div>

        {/* Footer */}
        <footer className="footer">
          Powered by{' '}
          <a href="https://usetheo.dev" target="_blank" rel="noopener noreferrer">
            TheoKit
          </a>
          {' · '}
          <a href="https://github.com/usetheodev/theokit" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          {' · '}
          <a href="https://discord.usetheo.dev" target="_blank" rel="noopener noreferrer">
            Discord
          </a>
        </footer>
      </div>
    </div>
  )
}
