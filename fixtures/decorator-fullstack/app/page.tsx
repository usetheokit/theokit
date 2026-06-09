'use client'

import { useEffect, useState } from 'react'

interface Task {
  id: number
  title: string
  done: boolean
  priority: string
}

interface Stats {
  total: number
  done: number
  pending: number
}

type ApiMode = 'defineRoute' | 'decorator'

const API_BASE: Record<ApiMode, string> = {
  defineRoute: '/api/tasks',
  decorator: '/api/v2/tasks',
}

export default function TaskManagerPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<ApiMode>('decorator')

  const base = API_BASE[mode]

  async function refresh() {
    const [t, s] = await Promise.all([
      fetch(base).then((r) => (r.ok ? r.json() : [])),
      fetch(`${base}/stats`).then((r) => (r.ok ? r.json() : null)),
    ])
    setTasks(Array.isArray(t) ? t : [])
    setStats(s)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [mode])

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
      body: JSON.stringify({ title: newTitle }),
    })
    if (res.status === 422) {
      const data = await res.json()
      setError(data.error?.issues?.[0]?.message ?? 'Validation error')
      return
    }
    if (res.ok) {
      setNewTitle('')
      refresh()
    }
  }

  async function completeTask(id: number) {
    await fetch(`${base}/${id}/complete`, { method: 'POST', headers: { 'x-theo-action': '1' } })
    refresh()
  }

  async function deleteTask(id: number) {
    await fetch(`${base}/${id}`, { method: 'DELETE', headers: { 'x-theo-action': '1' } })
    refresh()
  }

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>

  return (
    <div>
      <h1 style={{ fontSize: '1.8rem', marginBottom: '0.25rem' }}>TheoKit Task Manager</h1>
      <p style={{ color: '#888', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Full-stack: React frontend consuming{' '}
        {mode === 'decorator' ? '@Controller decorator API' : 'defineRoute API'}
      </p>

      {/* API Mode toggle — proves both paths work e2e */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => {
            setMode('decorator')
            setLoading(true)
          }}
          style={{
            padding: '0.4rem 1rem',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.85rem',
            background: mode === 'decorator' ? '#2563eb' : '#262626',
            color: mode === 'decorator' ? 'white' : '#888',
          }}
        >
          @Controller (v2)
        </button>
        <button
          onClick={() => {
            setMode('defineRoute')
            setLoading(true)
          }}
          style={{
            padding: '0.4rem 1rem',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.85rem',
            background: mode === 'defineRoute' ? '#2563eb' : '#262626',
            color: mode === 'defineRoute' ? 'white' : '#888',
          }}
        >
          defineRoute (v1)
        </button>
        <span style={{ color: '#555', fontSize: '0.75rem', alignSelf: 'center' }}>{base}</span>
      </div>

      {stats && (
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#60a5fa' }}>{stats.total}</div>
            <div style={{ fontSize: '0.8rem', color: '#888' }}>Total</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#4ade80' }}>{stats.done}</div>
            <div style={{ fontSize: '0.8rem', color: '#888' }}>Done</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#fbbf24' }}>
              {stats.pending}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#888' }}>Pending</div>
          </div>
        </div>
      )}

      <div
        style={{
          background: '#171717',
          border: '1px solid #333',
          borderRadius: '12px',
          padding: '1.25rem',
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Add Task</h2>
        <form onSubmit={createTask} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="What needs to be done?"
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              background: '#262626',
              border: '1px solid #404040',
              borderRadius: '8px',
              color: '#e5e5e5',
              fontSize: '0.9rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '0.5rem 1rem',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Add
          </button>
        </form>
        {error && (
          <p style={{ color: '#f87171', marginTop: '0.5rem', fontSize: '0.85rem' }}>{error}</p>
        )}
      </div>

      <div
        style={{
          background: '#171717',
          border: '1px solid #333',
          borderRadius: '12px',
          padding: '1.25rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Tasks</h2>
        {tasks.length === 0 && <p style={{ color: '#666' }}>No tasks yet. Add one above.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tasks.map((task) => (
            <li
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0',
                borderBottom: '1px solid #262626',
              }}
            >
              <button
                onClick={() => !task.done && completeTask(task.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: task.done ? 'default' : 'pointer',
                  fontSize: '1.1rem',
                  padding: 0,
                }}
                disabled={task.done}
              >
                {task.done ? '✅' : '⬜'}
              </button>
              <span
                style={{
                  flex: 1,
                  textDecoration: task.done ? 'line-through' : 'none',
                  color: task.done ? '#555' : '#e5e5e5',
                }}
              >
                {task.title}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontSize: '0.7rem',
                  fontWeight: 500,
                  background:
                    task.priority === 'high'
                      ? '#451a03'
                      : task.priority === 'medium'
                        ? '#172554'
                        : '#052e16',
                  color:
                    task.priority === 'high'
                      ? '#fbbf24'
                      : task.priority === 'medium'
                        ? '#60a5fa'
                        : '#4ade80',
                }}
              >
                {task.priority}
              </span>
              <button
                onClick={() => deleteTask(task.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  padding: '0 0.25rem',
                }}
                onMouseOver={(e) => (e.currentTarget.style.color = '#f87171')}
                onMouseOut={(e) => (e.currentTarget.style.color = '#666')}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
